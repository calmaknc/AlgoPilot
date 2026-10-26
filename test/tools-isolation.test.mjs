import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAgentTools } from '../src/tools/index.ts';

test('独立注册表的六种笔记工具全部使用注入目录', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mini-agent-tools-isolation-'));
    try {
        const url = name => pathToFileURL(join(root,name)+'/');
        await Promise.all(['notes','exports','other'].map(name=>mkdir(url(name))));
        const tools=createAgentTools({notesDirectory:url('notes'),exportsDirectory:url('exports')});
        const other=createAgentTools({notesDirectory:url('other'),exportsDirectory:url('other')});
        const run=async(name,args)=>{
            const value=JSON.parse(await tools.executeTool(name,JSON.stringify(args)));
            assert.equal(value.ok,true,value.error);return value;
        };
        const note={title:'isolation',problem:{number:49},content:'unchanged\nprint(1)\n',tags:[]};
        const saved=await run('save_practice_note',{note});
        assert.equal((await readdir(url('notes'))).length,1);
        assert.equal(JSON.parse(await other.executeTool('search_practice_notes','{}')).total,0);
        assert.equal((await run('search_practice_notes',{number:49})).matches[0].id,saved.id);
        assert.deepEqual((await run('get_practice_note',{id:saved.id})).note.content,note.content);
        await run('update_practice_note',{id:saved.id,note:{tags:['updated']}});
        assert.deepEqual((await run('get_practice_note',{id:saved.id})).note.tags,['updated']);
        const exported=await run('export_practice_note_markdown',{id:saved.id});
        assert.equal(exported.path.startsWith(join(root,'exports')+'/'),true);
        assert.match(await readFile(exported.path,'utf8'),/print\(1\)/);
        await run('delete_practice_note',{id:saved.id});
        assert.deepEqual(await readdir(url('notes')),[]);
        assert.deepEqual(await readdir(url('other')),[]);
    } finally {await rm(root,{recursive:true,force:true});}
});
