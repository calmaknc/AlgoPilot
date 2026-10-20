async function main(): Promise<void> {
    const response = await fetch(
        'https://jsonplaceholder.typicode.com/posts/99999'
    );

    // const response = await fetch(
    //     'https://jsonplaceholder.typicode.com/posts',
    //     {
    //         method: 'POST',
    //         headers: {
    //             'Content-Type': 'application/json'
    //         },
    //         body: JSON.stringify(
    //             {
    //                 title: 'my first http request',
    //                 body: 'I am learning TypeScript',
    //                 userId: 1
    //             }
    //         )
    //     }
    // );

    console.log('状态码： ', response.status);

    if (!response.ok) {
        throw new Error(`HTTP 请求失败：${response.status}`);
    }

    const data = await response.json();
    
    console.log('完整数据： ', data);
    console.log('标题： ', data.title);
}

main().catch(
    (error: unknown) => {
        console.error('请求失败： ', error);
    }
);