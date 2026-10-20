/** 业务错误同时携带 HTTP 状态和稳定错误码，终端也可以直接显示 message。 */
export class AppError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(status: number, code: string, message: string) {
        super(message);
        this.name = 'AppError';
        this.status = status;
        this.code = code;
    }
}
