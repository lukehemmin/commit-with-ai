// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { AiCommitProvider } from './aiCommitProvider';
import { CommitViewProvider } from './commitViewProvider';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
	console.log('Activating commit-with-ai extension');
	
	// 변수를 try-catch 블록 외부에서 선언하여 전체 함수 범위에서 접근 가능하게 함
	let aiCommitProvider: AiCommitProvider;
	let commitViewProvider: CommitViewProvider;
	
	try {
		// Check if Git extension is available
		const gitExtension = vscode.extensions.getExtension('vscode.git');
		if (!gitExtension) {
			console.error('Git extension is not available');
			throw new Error('Git extension is not available');
		}
		
		if (!gitExtension.isActive) {
			console.log('Waiting for Git extension to activate');
			await gitExtension.activate();
			console.log('Git extension activated successfully');
		}

		// Git 저장소 확인
		const git = gitExtension.exports.getAPI(1);
		console.log('Git API 버전:', git.version);
		
		const repositories = git.repositories;
		console.log('Git 저장소 수:', repositories.length);
		
		if (repositories.length === 0) {
			console.warn('현재 워크스페이스에 Git 저장소가 없습니다.');
			vscode.window.showWarningMessage('현재 워크스페이스에 Git 저장소가 없습니다. Git 저장소를 열어주세요.');
		}

		// Initialize AI commit provider instance
		console.log('AiCommitProvider 초기화 중...');
		aiCommitProvider = new AiCommitProvider(context);
		console.log('AiCommitProvider 초기화 완료');
		
		// Create webview provider
		console.log('CommitViewProvider 초기화 중...');
		commitViewProvider = new CommitViewProvider(context.extensionUri);
		console.log('CommitViewProvider 초기화 완료');

		// Register webview
		context.subscriptions.push(
			vscode.window.registerWebviewViewProvider(
				CommitViewProvider.viewType,
				commitViewProvider
			)
		);

		// 초기화 시 aiCommitProvider 등록
		console.log('aiCommitProvider 등록 중...');
		commitViewProvider.registerProvider(aiCommitProvider);
		console.log('aiCommitProvider 등록 완료');
	} catch (error: any) {
		console.error('Error during extension activation:', error);
		vscode.window.showErrorMessage(`Failed to activate commit-with-ai extension: ${error.message}`);
		return;
	}

	// 파일 목록 새로고침 명령어 등록
	let refreshFilesCommand = vscode.commands.registerCommand('commit-with-ai.refreshFiles', async () => {
		try {
			await commitViewProvider.refreshChangedFiles();
			vscode.window.showInformationMessage('변경된 파일 목록을 새로고침했습니다.');
		} catch (error: any) {
			vscode.window.showErrorMessage(`파일 목록 새로고침 중 오류가 발생했습니다: ${error.message}`);
			console.error('Error refreshing files:', error);
		}
	});

	// 선택된 파일로 커밋 메시지 생성 명령어 등록
	let generateWithSelectedCommand = vscode.commands.registerCommand('commit-with-ai.generateWithSelected', async (fileUris: vscode.Uri[]) => {
		try {
			if (!fileUris || fileUris.length === 0) {
				vscode.window.showWarningMessage('선택된 파일이 없습니다. 파일을 선택한 후 다시 시도해주세요.');
				return;
			}

			// 선택된 파일 경로 추출
			const selectedFiles = fileUris.map(uri => uri.fsPath);
			
			// 선택된 파일의 diff 내용 가져오기
			const diffContent = await aiCommitProvider.getChangesDiff(selectedFiles);
			
			if (!diffContent || diffContent.trim() === '') {
				vscode.window.showWarningMessage('선택된 파일에 변경 사항이 없습니다.');
				return;
			}
			
			// AI로 커밋 메시지 생성
			const commitMessage = await aiCommitProvider.generateCommitMessage(diffContent);
			
			// 결과 업데이트
			commitViewProvider.updateContent(commitMessage, diffContent);
			
			// 웹뷰 포커스
			await vscode.commands.executeCommand('workbench.view.extension.' + CommitViewProvider.viewType);
			
			vscode.window.showInformationMessage('선택한 파일로 AI 커밋 메시지가 생성되었습니다.');
		} catch (error: any) {
			vscode.window.showErrorMessage(`커밋 메시지 생성 중 오류가 발생했습니다: ${error.message}`);
			console.error('Error generating commit message with selected files:', error);
		}
	});

	// 기존 명령어 수정: 'commit-with-ai.generateCommitMessage'
	let generateCommitCommand = vscode.commands.registerCommand('commit-with-ai.generateCommitMessage', async () => {
		try {
			// 웹뷰 포커스
			await vscode.commands.executeCommand('workbench.view.extension.' + CommitViewProvider.viewType);
			
			// 변경된 파일 목록 새로고침
			await commitViewProvider.refreshChangedFiles();
			
			vscode.window.showInformationMessage('파일을 선택하고 "AI가 커밋 작성" 버튼을 클릭하세요.');
			return;

			// 이 기능은 웹뷰에서 직접 처리하도록 변경되었습니다.
			// 사용자는 웹뷰에서 파일을 선택하고 "AI가 커밋 작성" 버튼을 클릭하여 커밋 메시지를 생성할 수 있습니다.
		} catch (error: any) {
			vscode.window.showErrorMessage(`커밋 메시지 생성 중 오류가 발생했습니다: ${error.message}`);
			console.error('Error generating commit message:', error);
		}
	});

	// 명령어 등록
	context.subscriptions.push(generateCommitCommand);
	context.subscriptions.push(refreshFilesCommand);
	context.subscriptions.push(generateWithSelectedCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {}
