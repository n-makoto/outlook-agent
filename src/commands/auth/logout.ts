import { spawn } from 'child_process';
import chalk from 'chalk';

export async function logout(): Promise<void> {
  try {
    console.log(chalk.blue('Logging out from Microsoft Graph...'));
    
    // mgc logoutコマンドを実行
    const mgcProcess = spawn('mgc', ['logout'], {
      stdio: 'inherit',
      shell: true
    });

    // プロセスの終了を待つ
    await new Promise<void>((resolve, reject) => {
      mgcProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Logout process exited with code ${code}`));
        }
      });

      mgcProcess.on('error', (err) => {
        reject(err);
      });
    });
    
    console.log(chalk.green('\n✓ Successfully logged out!'));
    console.log(chalk.gray('\nTo login again:'));
    console.log(chalk.cyan('  npx outlook-agent login'));
  } catch (error: any) {
    console.error(chalk.red('\nLogout failed:'), error.message || error);
    process.exit(1);
  }
}