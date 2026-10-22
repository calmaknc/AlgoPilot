// 先验证参考实现；手抄完毕后可以把导入改为 ./sandbox.ts。
import { runPythonSandbox } from '../sandbox/runner.ts';

const examples: Record<string, { code: string; stdin: string }> = {
    hello: { code: "name = input()\nprint('你好，' + name)", stdin: '小明\n' },
    error: { code: "raise ValueError('测试错误')", stdin: '' },
    timeout: { code: 'while True: pass', stdin: '' },
    output: { code: "while True: print('x' * 4096)", stdin: '' },
    readonly: { code: "open('/probe.txt', 'w').write('test')", stdin: '' },
    network: { code: "import socket\nsocket.create_connection(('1.1.1.1', 80), timeout=1)", stdin: '' },
};
const example = examples[process.argv[2] ?? 'hello'];
if (!example) throw new Error('示例名：hello / error / timeout / output / readonly / network');
console.log(await runPythonSandbox(example));
