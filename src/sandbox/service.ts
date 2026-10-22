import { AppError } from '../shared/errors.ts';
import { parseSandboxInput, runPythonSandbox, type SandboxInput, type SandboxResult } from './runner.ts';

type Runner = (input: SandboxInput) => Promise<SandboxResult>;

/** HTTP 和工具共用服务。测试可以注入假执行器，避免调用 Docker。 */
export function createSandboxService(runner: Runner = runPythonSandbox) {
    let busy = false;
    let cleanupBlocked = false;

    async function run(value: unknown): Promise<SandboxResult> {
        let input: SandboxInput;
        try {
            input = parseSandboxInput(value);
        } catch (error) {
            throw new AppError(400, 'INVALID_SANDBOX_INPUT', error instanceof Error ? error.message : '沙箱参数错误');
        }
        if (cleanupBlocked) {
            throw new AppError(503, 'SANDBOX_CLEANUP_REQUIRED', '上次容器清理失败，请检查残留容器后重启服务');
        }
        if (busy) throw new AppError(429, 'SANDBOX_BUSY', '沙箱正在执行其他任务，请稍后重试');
        // 在 await 前占用名额；限制同进程中 HTTP 与 Agent 合计一个任务。
        busy = true;
        try {
            const result = await runner(input);
            if (result.cleanupError) cleanupBlocked = true;
            return result;
        } catch (error) {
            // 执行器意外抛错时无法确认清理状态，停止接受后续任务。
            cleanupBlocked = true;
            throw new AppError(503, 'SANDBOX_UNAVAILABLE', '沙箱执行异常，请检查容器状态后重启服务');
        } finally {
            // runner 返回前包含容器清理；不能提前释放名额。
            busy = false;
        }
    }
    return { run };
}

export type SandboxService = ReturnType<typeof createSandboxService>;
export const sandboxService = createSandboxService();
