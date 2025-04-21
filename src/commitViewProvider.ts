import * as vscode from 'vscode';
import { AiCommitProvider } from './aiCommitProvider';

export class CommitViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'aiCommitView';
  private _view?: vscode.WebviewView;
  private _extensionUri: vscode.Uri;
  private _commitMessage: string = '';
  private _diffContent: string = '';
  private _changedFiles: { path: string, selected: boolean }[] = [];
  private provider?: AiCommitProvider;

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;
  }

  public registerProvider(provider: AiCommitProvider) {
    console.log('CommitViewProvider: registerProvider 호출됨');
    this.provider = provider;
    console.log('CommitViewProvider: provider 등록 완료', this.provider ? '성공' : '실패');
  }

  /**
   * 변경된 파일 목록을 새로고침합니다.
   * 이 메서드는 public으로, 외부에서 호출할 수 있습니다.
   */
  public async refreshChangedFiles(): Promise<void> {
    await this._loadChangedFiles();
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

    // 변경된 파일 목록 로드
    this._loadChangedFiles();

    this._updateWebview();

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'applyCommit':
            await this._applyCommitMessage(message.message);
            break;
          case 'regenerate':
            await this._regenerateCommitMessage();
            break;
          case 'generateCommit':
            await this._generateCommitWithSelectedFiles(message.selectedFiles);
            break;
          case 'refreshFiles':
            await this._loadChangedFiles();
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

  private async _loadChangedFiles() {
    try {
      console.log('CommitViewProvider: _loadChangedFiles 호출됨');
      if (!this.provider) {
        console.error('CommitViewProvider: provider가 등록되지 않았습니다.');
        vscode.window.showErrorMessage('보기 데이터를 제공할 수 있는 등록된 데이터 공급자가 없습니다.');
        return;
      }
      console.log('CommitViewProvider: provider 확인됨');

      // Git 확장 가져오기
      const gitExtension = vscode.extensions.getExtension('vscode.git');
      if (!gitExtension) {
        throw new Error('Git extension not found');
      }
      
      const git = gitExtension.exports.getAPI(1);
      const repo = git.repositories[0];
      
      if (!repo) {
        throw new Error('No Git repository found');
      }

      // 변경된 파일 목록 가져오기
      const changes = repo.state.workingTreeChanges;
      this._changedFiles = changes.map((change: { uri: vscode.Uri }) => ({
        path: vscode.workspace.asRelativePath(change.uri.fsPath),
        selected: true
      }));

      this._updateWebview();
    } catch (error: any) {
      vscode.window.showErrorMessage(`변경된 파일 목록을 가져오는 중 오류가 발생했습니다: ${error.message}`);
      console.error('Error loading changed files:', error);
    }
  }

  private _updateWebview() {
    if (!this._view) {
      return;
    }

    this._view.webview.html = this._getHtmlForWebview();
  }

  private _getHtmlForWebview() {
    // 변경된 파일 목록 HTML 생성
    const changedFilesHtml = this._changedFiles.length > 0 
      ? `
        <div class="files-container">
          <h3>변경된 파일</h3>
          <div class="file-list">
            ${this._changedFiles.map((file, index) => `
              <div class="file-item">
                <input type="checkbox" id="file-${index}" data-path="${file.path}" ${file.selected ? 'checked' : ''}>
                <label for="file-${index}">${file.path}</label>
              </div>
            `).join('')}
          </div>
          <div class="button-container">
            <button id="generate-button">AI가 커밋 작성</button>
            <button id="refresh-button">새로고침</button>
          </div>
        </div>
      ` 
      : `
        <div class="empty-state">
          <p>변경된 파일이 없습니다. 파일을 수정한 후 새로고침 버튼을 클릭하세요.</p>
          <button id="refresh-button">새로고침</button>
        </div>
      `;

    // 커밋 메시지 HTML 생성
    const commitMessageHtml = this._commitMessage 
      ? `
        <h3>AI 생성 커밋 메시지</h3>
        <div class="message-container">
          <textarea id="commit-message">${this._commitMessage}</textarea>
        </div>
        <div class="button-container">
          <button id="apply-button">적용</button>
          <button id="regenerate-button">재생성</button>
        </div>
        <h4>변경 내용 (Diff)</h4>
        <div class="diff-container">
          <pre>${this._diffContent}</pre>
        </div>
      ` 
      : '';

    // Basic HTML template for the webview
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
        .empty-state {
          text-align: center;
          padding: 30px;
          color: var(--vscode-descriptionForeground);
        }
        .files-container {
          margin-bottom: 20px;
        }
        .file-list {
          max-height: 200px;
          overflow-y: auto;
          border: 1px solid var(--vscode-input-border);
          padding: 8px;
          margin-bottom: 10px;
        }
        .file-item {
          display: flex;
          align-items: center;
          margin-bottom: 5px;
        }
        .file-item label {
          margin-left: 5px;
          cursor: pointer;
        }
      </style>
    </head>
    <body>
      <div class="container">
        ${changedFilesHtml}
        ${commitMessageHtml}
      </div>
      <script>
        const vscode = acquireVsCodeApi();
        
        document.addEventListener('DOMContentLoaded', () => {
          const commitMessageElement = document.getElementById('commit-message');
          const applyButton = document.getElementById('apply-button');
          const regenerateButton = document.getElementById('regenerate-button');
          const generateButton = document.getElementById('generate-button');
          const refreshButton = document.getElementById('refresh-button');
          
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

          if (generateButton) {
            generateButton.addEventListener('click', () => {
              const checkboxes = document.querySelectorAll('input[type="checkbox"]');
              const selectedFiles = Array.from(checkboxes)
                .filter(checkbox => checkbox.checked)
                .map(checkbox => checkbox.getAttribute('data-path'));
              
              vscode.postMessage({
                command: 'generateCommit',
                selectedFiles
              });
            });
          }

          if (refreshButton) {
            refreshButton.addEventListener('click', () => {
              vscode.postMessage({
                command: 'refreshFiles'
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
      // Get Git extension
      const gitExtension = vscode.extensions.getExtension('vscode.git');
      if (!gitExtension) {
        throw new Error('Git extension not found');
      }
      
      const git = gitExtension.exports.getAPI(1);
      const repo = git.repositories[0];
      
      if (!repo) {
        throw new Error('No Git repository found');
      }
      
      // Set commit message in SCM input box
      repo.inputBox.value = message;
      
      vscode.window.showInformationMessage('커밋 메시지가 적용되었습니다. Git 인터페이스에서 확인하세요.');
    } catch (error: any) {
      vscode.window.showErrorMessage(`커밋 메시지 적용 중 오류가 발생했습니다: ${error.message}`);
      console.error('Error applying commit message:', error);
    }
  }

  private async _regenerateCommitMessage() {
    try {
      vscode.window.showInformationMessage('커밋 메시지를 재생성 중입니다...');
      await vscode.commands.executeCommand('commit-with-ai.generateCommitMessage');
    } catch (error: any) {
      vscode.window.showErrorMessage(`커밋 메시지 재생성 중 오류가 발생했습니다: ${error.message}`);
      console.error('Error regenerating commit message:', error);
    }
  }

  private async _generateCommitWithSelectedFiles(selectedFiles: string[]) {
    try {
      if (!this.provider) {
        throw new Error('AiCommitProvider가 등록되지 않았습니다.');
      }

      if (selectedFiles.length === 0) {
        vscode.window.showWarningMessage('선택된 파일이 없습니다. 파일을 선택해주세요.');
        return;
      }

      vscode.window.showInformationMessage('선택한 파일로 커밋 메시지를 생성 중입니다...');
      
      // 선택된 파일의 diff 내용 가져오기
      const diffContent = await this.provider.getChangesDiff(selectedFiles);
      
      // AI로 커밋 메시지 생성
      const commitMessage = await this.provider.generateCommitMessage(diffContent);
      
      // 결과 업데이트
      this.updateContent(commitMessage, diffContent);
      
    } catch (error: any) {
      vscode.window.showErrorMessage(`커밋 메시지 생성 중 오류가 발생했습니다: ${error.message}`);
      console.error('Error generating commit message with selected files:', error);
    }
  }
}
