import { spawn } from 'child_process';
import chalk from 'chalk';

export async function login(options: { scopes?: string } = {}): Promise<void> {
  try {
    // デフォルトで全ての必要な権限を要求
    const scopes = options.scopes || 'Calendars.ReadWrite Calendars.Read.Shared User.Read';
    
    console.log(chalk.blue('Logging in to Microsoft Graph...'));
    console.log(chalk.gray(`Requesting scopes: ${scopes}`));
    console.log(chalk.gray('Opening browser for authentication...'));
    
    // mgcコマンドを子プロセスとして実行（ブラウザを自動的に開く）
    const mgcProcess = spawn('mgc', ['login', '--scopes', scopes, '--strategy', 'InteractiveBrowser'], {
      stdio: 'inherit', // 標準入出力を継承して対話的に使えるようにする
      shell: true
    });

    // プロセスの終了を待つ
    await new Promise<void>((resolve, reject) => {
      mgcProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Login process exited with code ${code}`));
        }
      });

      mgcProcess.on('error', (err) => {
        reject(err);
      });
    });
    
    console.log(chalk.green('\n✓ Successfully logged in!'));
    console.log(chalk.gray('\nYou can now:'));
    console.log(chalk.gray('- Read and write your calendar'));
    console.log(chalk.gray('- Create and modify events'));
    console.log(chalk.gray('- View calendars shared with you'));
    console.log(chalk.gray('- Check free/busy information'));
    console.log(chalk.gray('- Access user information'));
    
    console.log(chalk.gray('\nNext steps:'));
    console.log(chalk.cyan('  node dist/index.js calendar view         # View your calendar'));
    console.log(chalk.cyan('  node dist/index.js calendar view --user  # View others\' calendar'));
    console.log(chalk.cyan('  node dist/index.js calendar freebusy     # Check availability'));
    console.log(chalk.cyan('  node dist/index.js calendar create -i    # Create an event'));
  } catch (error: any) {
    console.error(chalk.red('\nLogin failed:'), error.message || error);
    console.error(chalk.gray('\nTroubleshooting tips:'));
    console.error(chalk.gray('1. Make sure mgc is installed: brew install microsoftgraph/tap/msgraph-cli'));
    console.error(chalk.gray('2. Clear existing credentials: rm -rf ~/.mgc'));
    console.error(chalk.gray('3. Try again with: node dist/index.js login'));
    process.exit(1);
  }
}