import { exec } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';
import { MgcService } from '../services/mgc.js';

const execAsync = promisify(exec);

interface CheckResult {
  name: string;
  status: 'ok' | 'error' | 'warning';
  message: string;
}

export async function doctor(): Promise<void> {
  console.log(chalk.bold('\n🩺 Outlook Agent Doctor\n'));
  console.log('Checking your environment...\n');

  const checks: CheckResult[] = [];

  // Node.js version check
  try {
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.split('.')[0].substring(1));
    
    if (majorVersion >= 18) {
      checks.push({
        name: 'Node.js',
        status: 'ok',
        message: `${nodeVersion} (>= 18.0.0 required)`
      });
    } else {
      checks.push({
        name: 'Node.js',
        status: 'error',
        message: `${nodeVersion} (>= 18.0.0 required) - Please upgrade Node.js`
      });
    }
  } catch (error) {
    checks.push({
      name: 'Node.js',
      status: 'error',
      message: 'Could not detect Node.js version'
    });
  }

  // npm version check
  try {
    const { stdout: npmVersion } = await execAsync('npm --version');
    checks.push({
      name: 'npm',
      status: 'ok',
      message: `v${npmVersion.trim()}`
    });
  } catch (error) {
    checks.push({
      name: 'npm',
      status: 'error',
      message: 'npm is not installed'
    });
  }

  // mgc installation check
  try {
    const { stdout: mgcVersion } = await execAsync('mgc --version');
    checks.push({
      name: 'mgc (Microsoft Graph CLI)',
      status: 'ok',
      message: `${mgcVersion.trim()}`
    });
  } catch (error) {
    checks.push({
      name: 'mgc (Microsoft Graph CLI)',
      status: 'error',
      message: 'Not installed. Run: brew install microsoftgraph/tap/msgraph-cli'
    });
  }

  // mgc authentication check
  try {
    const mgc = new MgcService();
    const isAuthenticated = await mgc.checkAuth();
    
    if (isAuthenticated) {
      checks.push({
        name: 'mgc authentication',
        status: 'ok',
        message: 'Authenticated'
      });
    } else {
      checks.push({
        name: 'mgc authentication',
        status: 'warning',
        message: 'Not authenticated. Run: mgc login'
      });
    }
  } catch (error) {
    checks.push({
      name: 'mgc authentication',
      status: 'error',
      message: 'Could not check authentication status'
    });
  }

  // Check for required files
  try {
    const { existsSync } = await import('fs');
    const distExists = existsSync('./dist/index.js');
    
    if (distExists) {
      checks.push({
        name: 'Build files',
        status: 'ok',
        message: 'dist/ directory exists'
      });
    } else {
      checks.push({
        name: 'Build files',
        status: 'warning',
        message: 'dist/ directory not found. Run: npm run build'
      });
    }
  } catch (error) {
    checks.push({
      name: 'Build files',
      status: 'error',
      message: 'Could not check build files'
    });
  }

  // Display results
  console.log(chalk.gray('─'.repeat(60)));
  
  checks.forEach(check => {
    const icon = check.status === 'ok' ? '✅' : 
                 check.status === 'warning' ? '⚠️ ' : '❌';
    const color = check.status === 'ok' ? chalk.green :
                  check.status === 'warning' ? chalk.yellow : chalk.red;
    
    console.log(`${icon} ${chalk.bold(check.name)}`);
    console.log(`   ${color(check.message)}`);
    console.log();
  });

  console.log(chalk.gray('─'.repeat(60)));

  // Summary
  const errors = checks.filter(c => c.status === 'error').length;
  const warnings = checks.filter(c => c.status === 'warning').length;
  
  if (errors > 0) {
    console.log(chalk.red(`\n❌ ${errors} error(s) found. Please fix them before using outlook-agent.`));
    process.exit(1);
  } else if (warnings > 0) {
    console.log(chalk.yellow(`\n⚠️  ${warnings} warning(s) found. Some features may not work properly.`));
  } else {
    console.log(chalk.green('\n✅ All checks passed! You\'re ready to use outlook-agent.'));
  }

  // Quick start guide
  console.log(chalk.bold('\n📚 Quick Start:'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log('View your calendar:  ' + chalk.cyan('node dist/index.js calendar view'));
  console.log('View others:         ' + chalk.cyan('node dist/index.js calendar view --user'));
  console.log('Create event:        ' + chalk.cyan('node dist/index.js calendar create --interactive'));
  console.log();
}