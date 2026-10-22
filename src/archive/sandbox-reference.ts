import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/** 完整教学参考：先单独运行验证，再接入 HTTP/Agent。 */
export type SandboxInput = {
    code: string;
    stdin: string;
};

export type SandboxResult = {
    status: 'completed' | 'timeout' | 'output_limit' | 'infrastructure_error';
    stdout: string;
    stderr: string;
    exitCode: number | null;
    durationMs: number;
    error?: string; // 基础设施错误，与用户程序 stderr 分开
    cleanupError?: string; // 清理失败时提示容器可能残留
};

// 限制由后端决定，不能允许模型或请求方任意放大。
export const SANDBOX_LIMITS = {
    codeBytes: 32 * 1024,
    stdinBytes: 16 * 1024,
    outputBytes: 64 * 1024, // stdout + stderr 合计
    timeoutMs: 3_000, // 执行阶段墙钟时间，基础设施启动需另设超时
    memoryMb: 128,
    cpus: 0.5,
    pids: 32,
} as const;

/** S1（已完成）：输入校验，不执行代码。
 * 1. value 必须是非 null、非数组的对象。
 * 2. code 必须是 trim 后非空的字符串，UTF-8 字节数 <= codeBytes。
 * 3. stdin 未提供时使用 ''；提供时必须是字符串，字节数 <= stdinBytes。
 * 4. 返回 { code, stdin }，保留原文，尤其代码缩进和输入换行。
 * 不从输入接收 shell 命令、镜像名称、宿主机路径或资源限制。
 */
export function parseSandboxInput(value: unknown): SandboxInput {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('沙箱输入必须是对象');
    }
    if (!('code' in value) || typeof value.code !== 'string' || value.code.trim().length === 0) {
        throw new Error('code 必须是非空白字符串');
    }
    if (value.code.includes('\0')) throw new Error('代码不能包含 NUL 字符');
    if (Buffer.byteLength(value.code, 'utf8') > SANDBOX_LIMITS.codeBytes) {
        throw new Error('代码超过 32 KiB 限制');
    }

    const stdin = 'stdin' in value && value.stdin !== undefined ? value.stdin : '';
    if (typeof stdin !== 'string') {
        throw new Error('stdin 必须是字符串');
    }
    if (Buffer.byteLength(stdin, 'utf8') > SANDBOX_LIMITS.stdinBytes) {
        throw new Error('标准输入超过 16 KiB 限制');
    }

    // 明确选取字段，外部传入的镜像、路径或限制不会进入执行器。
    return { code: value.code, stdin };
}

// 1. 固定环境。先手动 docker pull；运行请求不得自行拉取镜像。
const PYTHON_IMAGE = 'python:3.12-slim';
const CONTROL_TIMEOUT_MS = 10_000;

type CommandResult = {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    reason?: 'timeout' | 'output_limit' | 'process_error';
    error?: string;
};

// 2. 把 Node 的进程事件转换成 Promise。
// 此函数只管理 Docker CLI；真正的容器由外层 finally 删除。
function dockerCommand(
    args: string[],
    stdin = '',
    timeoutMs = CONTROL_TIMEOUT_MS,
    outputLimit = 16 * 1024,
): Promise<CommandResult> {
    return new Promise((resolve) => {
        const child = spawn('docker', args, {
            shell: false,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let totalBytes = 0;
        let reason: CommandResult['reason'];
        let error: string | undefined;
        let settled = false;
        let forceFinish: ReturnType<typeof setTimeout> | undefined;

        // 只结算一次；error、close、超时等事件可能先后发生。
        function finish(exitCode: number | null) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (forceFinish) clearTimeout(forceFinish);
            child.stdin.destroy();
            child.stdout.destroy();
            child.stderr.destroy();
            child.unref();
            resolve({
                stdout: Buffer.concat(stdout).toString('utf8'),
                stderr: Buffer.concat(stderr).toString('utf8'),
                exitCode, reason, error,
            });
        }

        function stop(cause: NonNullable<CommandResult['reason']>, message: string) {
            if (reason || settled) return;
            reason = cause;
            error = message;
            child.kill('SIGKILL');
            // 即使 CLI 未及时 close，也要把控制权交回外层去清理容器。
            forceFinish = setTimeout(() => finish(null), 1_000);
        }

        // 3. 同时限制 stdout + stderr，避免无限打印耗尽 Node 内存。
        function collect(chunk: Buffer, target: Buffer[]) {
            if (settled || reason) return;
            const remaining = outputLimit - totalBytes;
            if (remaining > 0) {
                // 拷贝截取部分，避免仍引用一个很大的原始 Buffer。
                target.push(Buffer.from(chunk.subarray(0, remaining)));
            }
            totalBytes += chunk.length;
            if (totalBytes > outputLimit) {
                stop('output_limit', '输出超过大小限制');
            }
        }

        const timer = setTimeout(() => stop('timeout', '命令超时'), timeoutMs);
        child.stdout.on('data', (chunk: Buffer) => collect(chunk, stdout));
        child.stderr.on('data', (chunk: Buffer) => collect(chunk, stderr));
        child.once('error', (err) => {
            reason ??= 'process_error';
            error ??= err.message;
            finish(null);
        });
        // close 表示进程结束且标准流已关闭，比 exit 更适合收集完整输出。
        child.once('close', (code) => finish(reason ? null : code));
        child.stdin.on('error', (err: NodeJS.ErrnoException) => {
            // Python 可以不读取 stdin 就正常退出，此时 EPIPE 不等于运行失败。
            if (err.code !== 'EPIPE' && err.code !== 'ERR_STREAM_DESTROYED') {
                stop('process_error', err.message);
            }
        });
        child.stdin.end(stdin);
    });
}

function describeFailure(result: CommandResult): string {
    return result.error ?? (result.stderr.trim() || `Docker 命令失败：${result.exitCode}`);
}

// 4. 将容器状态 JSON 缩小为需要的字段；校验代码已提供，无需手写练习。
function parseContainerState(raw: string): { status: string; exitCode: number; error: string } {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null ||
        !('Status' in value) || typeof value.Status !== 'string' ||
        !('ExitCode' in value) || typeof value.ExitCode !== 'number' || !Number.isInteger(value.ExitCode) ||
        !('Error' in value) || typeof value.Error !== 'string') {
        throw new Error('Docker 返回的容器状态不合法');
    }
    return { status: value.Status, exitCode: value.ExitCode, error: value.Error };
}

// 5. 一次任务 = 创建 → 启动并收集结果 → 检查状态 → 强制删除。
export async function runPythonSandbox(value: unknown): Promise<SandboxResult> {
    const input = parseSandboxInput(value);
    const name = `mini-agent-sandbox-${randomUUID()}`;
    const startedAt = performance.now();
    const result: SandboxResult = {
        status: 'infrastructure_error', stdout: '', stderr: '', exitCode: null, durationMs: 0,
    };
    let creationAttempted = false;

    try {
        // 先检查服务权限；失败时不尝试在宿主机运行 Python。
        const available = await dockerCommand(['info', '--format', '{{.ServerVersion}}']);
        if (available.reason || available.exitCode !== 0) {
            throw new Error(`Docker 不可用：${describeFailure(available)}`);
        }

        creationAttempted = true;
        const created = await dockerCommand([
            'create', '--name', name, '--pull=never',
            '--label', 'mini-agent.sandbox=true',
            '--interactive',
            '--network', 'none',
            '--read-only',
            '--user', '65534:65534',
            '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges',
            '--memory', `${SANDBOX_LIMITS.memoryMb}m`,
            '--memory-swap', `${SANDBOX_LIMITS.memoryMb}m`,
            '--cpus', String(SANDBOX_LIMITS.cpus),
            '--pids-limit', String(SANDBOX_LIMITS.pids),
            '--ulimit', 'nofile=64:64',
            '--log-driver', 'none',
            PYTHON_IMAGE,
            'python', '-I', '-B', '-u', '-c', input.code,
        ]);
        if (created.reason || created.exitCode !== 0) {
            throw new Error(`创建容器失败：${describeFailure(created)}`);
        }

        // 6. 这里的 3 秒包含 docker start 的启动开销，不是精确 CPU 用时。
        const execution = await dockerCommand(
            ['start', '--attach', '--interactive', name],
            input.stdin,
            SANDBOX_LIMITS.timeoutMs,
            SANDBOX_LIMITS.outputBytes,
        );
        result.stdout = execution.stdout;
        result.stderr = execution.stderr;
        if (execution.reason === 'timeout' || execution.reason === 'output_limit') {
            result.status = execution.reason;
        } else if (execution.reason) {
            throw new Error(describeFailure(execution));
        } else {
            // 区分 Docker 自身失败与用户程序 exit(1)；非零退出也属于已执行完。
            const inspected = await dockerCommand(['inspect', '--format', '{{json .State}}', name]);
            if (inspected.reason || inspected.exitCode !== 0) {
                throw new Error(`读取容器状态失败：${describeFailure(inspected)}`);
            }
            const state = parseContainerState(inspected.stdout);
            if (state.status !== 'exited' || state.error) {
                throw new Error(state.error || `容器未正常结束：${state.status}`);
            }
            if (execution.exitCode !== state.exitCode) {
                throw new Error('Docker CLI 与容器退出码不一致，执行结果不可信');
            }
            result.status = 'completed';
            result.exitCode = state.exitCode;
        }
    } catch (error) {
        result.status = 'infrastructure_error';
        result.error = error instanceof Error ? error.message : '沙箱基础设施异常';
    } finally {
        // 7. 杀 Docker CLI 不保证 Python 停止；必须删除真正的容器。
        // create 超时也可能已经创建成功，所以按提前生成的名称尝试清理。
        if (creationAttempted) {
            const removed = await dockerCommand(['rm', '--force', name]);
            // 容器不存在说明已经无须清理；其他错误要显式报告。
            const absent = !removed.reason && removed.exitCode !== 0 &&
                removed.stderr.includes(`No such container: ${name}`);
            if (!absent && (removed.reason || removed.exitCode !== 0)) {
                result.cleanupError = `容器 ${name} 可能残留：${describeFailure(removed)}`;
                result.status = 'infrastructure_error';
                result.exitCode = null;
            }
        }
        result.durationMs = Math.round(performance.now() - startedAt);
    }
    return result;
}
