import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPythonSandbox } from '../src/sandbox/runner.ts';

test('执行器：模拟 Docker 的正常/错误/超时/输出上限及清理', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sandbox-fake-'));
    const originalPath = process.env.PATH;
    const fake = join(dir, 'docker');
    const log = join(dir, 'calls.jsonl');
    const modeFile = join(dir, 'mode');
    await writeFile(fake, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const mode = fs.readFileSync(${JSON.stringify(modeFile)}, 'utf8');
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] === 'info') {
 if (mode === 'unavailable') { console.error('permission denied'); process.exit(1); }
 console.log('fake-version');
} else if (args[0] === 'create') {
 if(mode === 'create-fail') { console.error('image missing'); process.exit(1); }
 console.log('fake-id');
} else if (args[0] === 'start') {
 if(mode === 'timeout') { setInterval(() => {}, 1000); }
 else if(mode === 'output') { process.stdout.write('x'.repeat(70000)); }
 else if(mode === 'runtime') { console.error('ValueError'); process.exitCode=1; }
 else { let data=''; process.stdin.on('data', c => data+=c); process.stdin.on('end', () => console.log('你好 '+data.trim())); }
} else if (args[0] === 'inspect') {
 console.log(JSON.stringify({Status:'exited',ExitCode:mode === 'runtime'?1:0,Error:''}));
} else if (args[0] === 'rm') {
 if(mode==='cleanup-fail') {console.error('daemon unavailable');process.exit(1);}
 if(mode==='create-fail') {console.error('Error response from daemon: No such container: '+args[2]);process.exit(1);}
 console.log('removed');
}
`);
    await chmod(fake, 0o755);
    process.env.PATH = `${dir}:${originalPath}`;
    try {
        for (const [mode, status] of [
            ['normal','completed'], ['runtime','completed'], ['timeout','timeout'],
            ['output','output_limit'], ['cleanup-fail','infrastructure_error'],
            ['create-fail','infrastructure_error'], ['unavailable','infrastructure_error'],
        ]) {
            await writeFile(modeFile, mode);
            await writeFile(log, '');
            const result = await runPythonSandbox({code:'print(input())',stdin:'世界\n'});
            assert.equal(result.status, status, mode + JSON.stringify(result) + await readFile(log, 'utf8'));
            if(mode==='normal') { assert.equal(result.stdout,'你好 世界\n');assert.equal(result.exitCode,0); }
            if(mode==='runtime') { assert.match(result.stderr,/ValueError/);assert.equal(result.exitCode,1); }
            if(mode==='output') assert.ok(Buffer.byteLength(result.stdout) <= 65536);
            if(mode==='cleanup-fail') assert.match(result.cleanupError,/可能残留/);
            const calls=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);
            if(mode==='unavailable') assert.equal(calls.length,1);
            else {
                assert.equal(calls.at(-1)[0],'rm');
                const create=calls.find(args=>args[0]==='create');
                assert.equal(calls.at(-1)[2],create[2]);
                assert.ok(create.includes('--read-only'));
                assert.ok(create.includes('--pull=never'));
                assert.equal(create[create.indexOf('--network')+1],'none');
                assert.equal(create.at(-1),'print(input())');
                assert.equal(create.includes('--privileged'),false);
            }
        }
    } finally {
        if(originalPath === undefined) delete process.env.PATH;
        else process.env.PATH=originalPath;
        await rm(dir,{recursive:true,force:true});
    }
});
