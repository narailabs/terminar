import * as vscode from 'vscode';
import { ServerController } from './ServerController';

/**
 * Show a VS Code error notification for a server error, with an optional Retry button.
 * @param err The error that occurred
 * @param onRetry Optional callback invoked when the user clicks "Retry"
 */
export async function showServerError(err: Error, onRetry?: () => void): Promise<void> {
    const result = await vscode.window.showErrorMessage(
        `terminar server error: ${err.message}`,
        'Retry'
    );
    if (result === 'Retry' && onRetry) {
        onRetry();
    }
}

/**
 * Log a server error to a VS Code output channel with details.
 * @param channel The output channel to log to
 * @param err The error to log
 */
export function logServerError(channel: vscode.OutputChannel, err: Error): void {
    channel.appendLine(`[ServerError] ${err.message}`);
    if (err.stack) {
        channel.appendLine(`[ServerError] Stack: ${err.stack}`);
    }
}

/**
 * Wire up a ServerController's error event to show notifications and log to output channel.
 * @param controller The server controller to monitor
 * @param channel The output channel for logging
 * @param onRetry Optional retry callback
 */
export function setupServerErrorHandler(
    controller: ServerController,
    channel: vscode.OutputChannel,
    onRetry?: () => void
): void {
    controller.on('error', (err: Error) => {
        logServerError(channel, err);
        showServerError(err, onRetry);
    });
}
