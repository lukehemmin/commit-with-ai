import * as vscode from 'vscode';

export class CommitViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _extensionUri: vscode.Uri;
  private _commitMessage: string = '';
  private _diffContent: string = '';

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    this._updateWebview();

    // 웹뷰에서 VS Code로 메시지 수신
    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'applyCommit':
            await this._applyCommitMessage(message.message);
            break;
          case 'editMessage':
            await this._editCommitMessage(message.message);
            break;
          case 'regenerate':
            // 커밋 메시지 재생성 로직
            await this._regenerateCommitMessage();
            break;
        }
      },
      undefined,
      []
    );
  }

  public updateContent(commitMessage: string, diffContent: string) {
    this._commitMessage = commitMessage;
    this._diffContent = diffContent;
    this._updateWebview();
  }

  private _updateWebview() {
    if (!this._view) {
      return;
    }

    this._view.webview.html = this._getHtmlForWebview();
  }

  private _getHtmlForWebview() {
    const commitMessageEncoded = this._commitMessage
      ? encodeURIComponent(this._commitMessage)
      : '';
    
    const diffContentEncoded = this._diffContent
      ? encodeURIComponent(this._diffContent)
      : '';

    return `<!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>AI 커밋 메시지</title>
      <style>
        body {
          font-family: var(--vscode-font-family);
          padding: 10px;
          color: var(--vscode-editor-foreground);
        }
        .container {
          display: flex;
          flex-direction: column;
          height: 100%;
        }
        .message-container {
          margin-bottom: 15px;
        }
        textarea {
          width: 100%;
          height: 120px;
          resize: vertical;
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          padding: 8px;
          font-family: var(--vscode-editor-font-family);
          font-size: var(--vscode-editor-font-size);
        }
        .diff-container {
          flex: 1;
          margin-top: 10px;
          border: 1px solid var(--vscode-panel-border);
          padding: 5px;
          overflow: auto;
          background-color: var(--vscode-editor-background);
          font-family: var(--vscode-editor-font-family);
          font-size: var(--vscode-editor-font-size);
        }
        pre {
          margin: 0;
          white-space: pre-wrap;
        }
        .button-container {
          display: flex;
          gap: 8px;
          margin: 10px 0;
        }
        button {
          padding: 6px 12px;
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          cursor: pointer;
        }
        button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
        .secondary-button {
          background-color: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
        }
        .empty-state {
          text-align: center;
          padding: 30px;
          color: var(--vscode-descriptionForeground);
        }
      </style>
    </head>
    <body>
      <div class="container">
        ${commitMessageEncoded ? `
        <h3>AI가 생성한 커밋 메시지</h3>
        <div class="message-container">
          <textarea id="commit-message">${decodeURIComponent(commitMessageEncoded)}</textarea>
        </div>
        <div class="button-container">
          <button id="apply-button">커밋 적용</button>
          <button id="regenerate-button" class="secondary-button">다시 생성</button>
        </div>
        <h4>변경 내용 (Diff)</h4>
        <div class="diff-container">
          <pre>${decodeURIComponent(diffContentEncoded)}</pre>
        </div>
        ` : `
        <div class="empty-state">
          <p>커밋할 변경 사항을 스테이징하고 "AI가 커밋 작성" 버튼을 클릭하세요.</p>
        </div>
        `}
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        
        document.addEventListener('DOMContentLoaded', () => {
          const commitMessageElement = document.getElementById('commit-message');
          const applyButton = document.getElementById('apply-button');
          const regenerateButton = document.getElementById('regenerate-button');
          
          if (applyButton) {
            applyButton.addEventListener('click', () => {
              const message = commitMessageElement.value;
              vscode.postMessage({
                command: 'applyCommit',
                message
              });
            });
          }
          
          if (regenerateButton) {
            regenerateButton.addEventListener('click', () => {
              vscode.postMessage({
                command: 'regenerate'
              });
            });
          }
          
          if (commitMessageElement) {
            commitMessageElement.addEventListener('input', () => {
              vscode.postMessage({
                command: 'editMessage',
                message: commitMessageElement.value
              });
            });
          }
        });
      </script>
    </body>
    </html>`;
  }

  private async _applyCommitMessage(message: string) {
    try {
      // Git 확장 가져오기
      const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
      if (!gitExtension) {
        vscode.window.showErrorMessage('Git 확장을 찾을 수 없습니다.');
        return;
      }

      const api = gitExtension.getAPI(1);
      const repositories = api.repositories;
      
      if (!repositories.length) {
        vscode.window.showErrorMessage('활성화된 Git 리포지토리가 없습니다.');
        return;
      }
      
      const repo = repositories[0];
      
      // 커밋 메시지 설정 및 커밋 실행
      repo.inputBox.value = message;
      
      // 사용자가 직접 커밋을 실행할 수 있도록 안내
      vscode.window.showInformationMessage('커밋 메시지가 설정되었습니다. 소스 컨트롤 탭으로 이동하여 커밋을 완료하세요.');
      
      // 소스 컨트롤 탭으로 이동
      vscode.commands.executeCommand('workbench.view.scm');
      
    } catch (error) {
      vscode.window.showErrorMessage(`커밋 메시지 적용 중 오류 발생: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async _editCommitMessage(message: string) {
    this._commitMessage = message;
  }

  private async _regenerateCommitMessage() {
    try {
      vscode.commands.executeCommand('commit-with-ai.generateCommitMessage');
    } catch (error) {
      vscode.window.showErrorMessage(`커밋 메시지 재생성 중 오류 발생: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
