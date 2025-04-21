import * as vscode from 'vscode';
import { OpenAI } from 'openai';

// Git 에러 인터페이스 정의
interface GitError extends Error {
  gitErrorCode?: string;
  message: string;
}

// 에러가 GitError 타입인지 확인하는 타입 가드 함수
function isGitError(error: unknown): error is GitError {
  return (
    error !== null &&
    typeof error === 'object' &&
    ('gitErrorCode' in error || 'message' in error)
  );
}

export class AiCommitProvider {
  private openai: OpenAI | undefined;
  private context: vscode.ExtensionContext;
  private gitExtension: any;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.initGitExtension();
    this.initOpenAI();
  }

  private initOpenAI() {
    const config = vscode.workspace.getConfiguration('commitWithAi');
    const apiKey = config.get<string>('openaiApiKey') || process.env.OPENAI_API_KEY;
    
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
    } else {
      console.warn('OpenAI API key not found. Please set it in settings or as environment variable.');
    }
  }

  private initGitExtension() {
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (gitExtension) {
      this.gitExtension = gitExtension.exports.getAPI(1);
    } else {
      console.error('Git extension not found');
    }
  }

  /**
   * Get diff content for changed files
   * @param filePaths Array of file paths to get diffs for
   * @returns Combined diff content as string
   */
  /**
   * Get diff content for selected files
   * @param filePaths Array of file paths to get diffs for. If empty, returns empty string.
   * @returns Combined diff content as string
   * @throws Error if Git extension is not initialized or repository is not found
   */
  async getChangesDiff(filePaths: string[]): Promise<string> {
    let allDiffs = '';
    
    if (!this.gitExtension) {
      const error = new Error('Git extension not initialized');
      vscode.window.showErrorMessage('Git 확장이 초기화되지 않았습니다. VS Code를 재시작해보세요.');
      throw error;
    }

    const repo = this.gitExtension.repositories[0];
    if (!repo) {
      const error = new Error('No Git repository found');
      vscode.window.showErrorMessage('Git 저장소를 찾을 수 없습니다. 현재 워크스페이스가 Git 저장소인지 확인하세요.');
      throw error;
    }
    
    if (filePaths.length === 0) {
      return '';
    }
    
    // 병렬로 모든 파일의 diff를 가져옴
    const diffPromises = filePaths.map(async (filePath) => {
      try {
        const uri = vscode.Uri.file(filePath);
        const fileRelativePath = vscode.workspace.asRelativePath(filePath);
        
        // Get diff for file
        const diff = await this.getFileDiff(repo, uri);
        
        if (diff) {
          return { path: fileRelativePath, diff };
        }
        return null;
      } catch (error) {
        console.error(`Error getting diff for file ${filePath}:`, error);
        vscode.window.showWarningMessage(`파일 ${filePath}의 변경 사항을 가져오는 중 오류가 발생했습니다.`);
        return null;
      }
    });
    
    const results = await Promise.all(diffPromises);
    
    // 결과 조합
    for (const result of results) {
      if (result) {
        allDiffs += `\n--- ${result.path} ---\n${result.diff}\n`;
      }
    }
    
    return allDiffs;
  }
  
  /**
   * Get diff for a single file
   * @param repo Git repository
   * @param uri File URI
   * @returns Diff content as string or undefined if error
   */
  /**
   * Get diff for a single file
   * @param repo Git repository
   * @param uri File URI
   * @returns Diff content as string or undefined if error
   */
  private async getFileDiff(repo: any, uri: vscode.Uri): Promise<string | undefined> {
    try {
      // 파일이 존재하는지 확인
      try {
        await vscode.workspace.fs.stat(uri);
      } catch (error) {
        console.warn(`File ${uri.fsPath} does not exist or cannot be accessed`);
        return undefined;
      }
      
      // 파일이 Git에 추적되고 있는지 확인
      try {
        await repo.show(uri, 'HEAD');
      } catch (error) {
        // 새 파일인 경우 전체 내용을 diff로 반환
        if (isGitError(error) && (
            error.gitErrorCode === 'NotAGitRepository' ||
            error.gitErrorCode === 'UnknownPath' ||
            error.message?.includes('did not match any file(s) known to git')
        )) {
          try {
            const content = await vscode.workspace.fs.readFile(uri);
            const textDecoder = new TextDecoder();
            return `+++ New file\n${textDecoder.decode(content)}`;
          } catch (readError) {
            console.error(`Error reading new file ${uri.fsPath}:`, readError);
            return undefined;
          }
        }
      }
      
      // Git diff 가져오기
      const diff = await repo.diffWithHEAD(uri);
      return diff;
    } catch (error) {
      console.error(`Error getting diff for file ${uri.fsPath}:`, error);
      return undefined;
    }
  }
  
  /**
   * Generate commit message using AI
   * @param diffContent Diff content to analyze
   * @returns Generated commit message
   */
  async generateCommitMessage(diffContent: string): Promise<string> {
    if (!this.openai) {
      throw new Error('OpenAI API is not initialized. Please set your API key in settings.');
    }

    try {
      // 커밋 메시지 생성을 위한 프롬프트
      const prompt = `
You are a helpful assistant that generates concise and informative Git commit messages based on code changes.
Analyze the following git diff and create a commit message that follows the Conventional Commits format.

The format should be:
<type>[optional scope]: <description>

[optional body]

Where type is one of:
- feat: A new feature
- fix: A bug fix
- docs: Documentation changes
- style: Code style changes (formatting, missing semi colons, etc)
- refactor: Code changes that neither fix bugs nor add features
- perf: Performance improvements
- test: Adding or updating tests
- chore: Changes to the build process, tooling, etc

Add an appropriate GitHub emoji at the beginning of the commit message.
Common GitHub emojis include:
- ✨ (sparkles) for new features
- 🐛 (bug) for bug fixes
- 📚 (books) for documentation
- 💄 (lipstick) for style changes
- ♻️ (recycle) for refactoring
- ⚡ (zap) for performance improvements
- ✅ (white_check_mark) for tests
- 🔧 (wrench) for configuration changes

Here is the diff:
\`\`\`
${diffContent}
\`\`\`

Generate a concise and informative commit message based on these changes.
`;

      // OpenAI API 호출
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are a helpful assistant that generates git commit messages.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 200,
        temperature: 0.5,
      });

      // 응답에서 커밋 메시지 추출
      let commitMessage = response.choices[0]?.message?.content?.trim() || '✨ feat: implement requested changes';
      
      // 커밋 메시지에서 타입 추출
      const typeMatch = commitMessage.match(/^(\w+)(\(.*?\))?:/);
      const type = typeMatch ? typeMatch[1] : 'feat';

      // 이모지 추가
      commitMessage = this.addEmojiToCommitMessage(commitMessage, type);
      
      return commitMessage;
    } catch (error) {
      console.error('Error generating commit message with AI:', error);
      
      // 더 자세한 오류 메시지 표시
      if (error instanceof Error) {
        if (error.message.includes('API key')) {
          vscode.window.showErrorMessage('OpenAI API 키가 유효하지 않거나 만료되었습니다. 설정에서 API 키를 확인해주세요.');
        } else if (error.message.includes('network')) {
          vscode.window.showErrorMessage('네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요.');
        } else if (error.message.includes('timeout')) {
          vscode.window.showErrorMessage('API 요청 시간이 초과되었습니다. 나중에 다시 시도해주세요.');
        } else {
          vscode.window.showErrorMessage(`AI 커밋 메시지 생성 실패: ${error.message}`);
        }
      } else {
        vscode.window.showErrorMessage('AI 커밋 메시지 생성에 실패했습니다.');
      }
      
      // 오류 발생 시 기본 커밋 메시지 반환
      return '✨ feat: implement requested changes';
    }
  }

  /**
   * Add GitHub emoji to commit message if not already present
   * @param commitMessage Original commit message
   * @param type Commit type (feat, fix, etc.)
   * @returns Commit message with emoji
   */
  private addEmojiToCommitMessage(commitMessage: string, type: string): string {
    // 이미 이모티콘이 있는지 확인
    if (/^\p{Emoji}/u.test(commitMessage)) {
      return commitMessage;
    }

    // 커밋 타입에 따른 이모티콘 매핑
    const emojiMap: Record<string, string> = {
      feat: '✨',
      fix: '🐛',
      docs: '📚',
      style: '💄',
      refactor: '♻️',
      perf: '⚡',
      test: '✅',
      chore: '🔧',
      build: '🏗️',
      ci: '🔄',
    };

    const emoji = emojiMap[type] || '✨';
    return `${emoji} ${commitMessage}`;
  }
}