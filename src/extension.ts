// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { AiCommitProvider } from './aiCommitProvider';
import { CommitViewProvider } from './commitViewProvider';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// AI 커밋 제공자 인스턴스 생성
	const aiCommitProvider = new AiCommitProvider();
	
	// 웹뷰 제공자 생성
	const commitViewProvider = new CommitViewProvider(context.extensionUri);
	
	// 웹뷰 등록
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			'aiCommitView',
			commitViewProvider
		)
	);

	// 명령어 등록
	let disposable = vscode.commands.registerCommand('commit-with-ai.generateCommitMessage', async () => {
		try {
			// 현재 Git 리포지토리 가져오기
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
			
			// 스테이징된 변경사항 없는 경우
			if (!repo.state.indexChanges.length && !repo.state.workingTreeChanges.length) {
				vscode.window.showInformationMessage('커밋할 변경사항이 없습니다.');
				return;
			}
			
			// 선택된 파일이 없을 경우 모든 스테이징된 파일 사용
			const selectedFiles = repo.state.indexChanges.map((change: any) => change.uri.fsPath);
			
			if (selectedFiles.length === 0) {
				vscode.window.showInformationMessage('스테이징된 파일이 없습니다. 파일을 스테이징한 후 다시 시도하세요.');
				return;
			}
			
			// 로딩 표시
			vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "AI 커밋 메시지 생성 중...",
				cancellable: false
			}, async (progress) => {
				progress.report({ increment: 0 });
				
				// 변경 내용 가져오기
				const diffs = await aiCommitProvider.getChangesDiff(repo, selectedFiles);
				
				progress.report({ increment: 50, message: "AI 분석 중..." });
				
				// AI 분석 및 커밋 메시지 생성
				const commitMessage = await aiCommitProvider.generateCommitMessage(diffs);
				
				progress.report({ increment: 100, message: "완료" });
				
				// 생성된 커밋 메시지를 웹뷰에 표시
				commitViewProvider.updateContent(commitMessage, diffs);
				
				// 사이드바 패널 열기
				vscode.commands.executeCommand('aiCommitView.focus');
				
				return;
			});
			
		} catch (error) {
			vscode.window.showErrorMessage(`오류 발생: ${error instanceof Error ? error.message : String(error)}`);
		}
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
