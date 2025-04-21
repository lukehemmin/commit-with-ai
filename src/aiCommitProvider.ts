import * as vscode from 'vscode';
import axios from 'axios';

export class AiCommitProvider {
  // 변경된 파일의 diff 가져오기
  async getChangesDiff(repo: any, filePaths: string[]): Promise<string> {
    let allDiffs = '';
    
    for (const filePath of filePaths) {
      try {
        // Git diff 명령어 실행
        const uri = vscode.Uri.file(filePath);
        const fileRelativePath = vscode.workspace.asRelativePath(filePath);
        
        // 파일의 diff 가져오기
        const diff = await this.getFileDiff(repo, uri);
        
        if (diff) {
          allDiffs += `\n--- ${fileRelativePath} ---\n${diff}\n`;
        }
      } catch (error) {
        console.error(`파일 ${filePath}의 diff를 가져오는 중 오류 발생:`, error);
      }
    }
    
    return allDiffs;
  }
  
  // 단일 파일의 diff 가져오기
  private async getFileDiff(repo: any, uri: vscode.Uri): Promise<string | undefined> {
    const relativePath = vscode.workspace.asRelativePath(uri);
    
    // Git diff 실행
    try {
      const result = await repo.diffIndexWithHEAD(relativePath);
      return result;
    } catch (error) {
      console.error(`파일 ${relativePath}의 diff를 가져오는 중 오류 발생:`, error);
      return undefined;
    }
  }
  
  // AI를 사용하여 커밋 메시지 생성
  async generateCommitMessage(diffContent: string): Promise<string> {
    try {
      // API 키 가져오기 (실제로는 설정에서 가져와야 함)
      const config = vscode.workspace.getConfiguration('aiCommitGenerator');
      const apiKey = config.get<string>('openaiApiKey') || process.env.OPENAI_API_KEY;
      
      if (!apiKey) {
        throw new Error('OpenAI API 키가 설정되지 않았습니다.');
      }
      
      // OpenAI API 요청
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: '당신은 Git 커밋 메시지를 작성하는 전문가입니다. 코드 변경 사항을 분석하고 적절한 GitHub 이모티콘과 함께 간결하고 명확한 커밋 메시지를 생성해주세요. 메시지는 제목 줄과 본문으로 구성되어야 합니다.'
            },
            {
              role: 'user',
              content: `다음 코드 변경 사항에 대한 커밋 메시지를 작성해주세요:\n\n${diffContent}`
            }
          ],
          temperature: 0.7,
          max_tokens: 500
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          }
        }
      );
      
      return response.data.choices[0].message.content.trim();
      
    } catch (error) {
      console.error('커밋 메시지 생성 중 오류 발생:', error);
      throw new Error('AI 커밋 메시지를 생성하는 중 오류가 발생했습니다.');
    }
  }
} 