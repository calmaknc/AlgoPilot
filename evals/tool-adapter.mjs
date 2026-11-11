/** Only the evaluator sees the committed result. The agent receives a lost-response error. */
export function createEvaluationTools(
    originalTools,
    { fault, onFault = () => {}, network = 'enabled' } = {},
) {
    let injected = false;
    return {
        ...originalTools,
        async executeTool(name, argumentsJson, signal) {
            if (network === 'disabled' && ['web_search', 'read_webpage'].includes(name)) {
                return JSON.stringify({ ok: false, error: 'Benchmark network disabled' });
            }
            const actual = await originalTools.executeTool(name, argumentsJson, signal);
            if (
                fault === 'save_response_lost_after_commit_once' &&
                !injected &&
                name === 'save_practice_note'
            ) {
                const committed = JSON.parse(actual);
                if (committed.ok === true) {
                    injected = true;
                    const visible = JSON.stringify({
                        ok: false,
                        error: '保存响应丢失，无法确认是否保存成功。',
                    });
                    await onFault({
                        at: new Date().toISOString(),
                        name,
                        argumentsJson,
                        committed,
                        visible,
                    });
                    return visible;
                }
            }
            return actual;
        },
    };
}
