import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { z } from 'zod';

// 設定ファイルのスキーマ
const ConfigSchema = z.object({
  timezone: z.string().optional(),
  model: z.string().optional(),
  notificationPolicy: z.object({
    decline: z.boolean().default(true),
    reschedule: z.boolean().default(true),
    accept: z.boolean().default(false),
  }).optional(),
  dataRetention: z.object({
    decisionsDays: z.number().default(90),
  }).optional(),
}).passthrough();

export type Config = z.infer<typeof ConfigSchema>;

// デフォルト設定
const defaultConfig: Config = {
  timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo',
  model: 'gpt-4-turbo',
  notificationPolicy: {
    decline: true,
    reschedule: true,
    accept: false,
  },
  dataRetention: {
    decisionsDays: 90,
  },
};

// 設定ファイルのパス
const getConfigPath = () => path.join(homedir(), '.outlook-agent', 'config.json');

/**
 * 設定を読み込む
 * 優先順位：環境変数 > 設定ファイル > デフォルト値
 */
export async function loadConfig(): Promise<Config> {
  let config = { ...defaultConfig };
  
  // 設定ファイルから読み込み
  try {
    const configPath = getConfigPath();
    const fileContent = await fs.readFile(configPath, 'utf-8');
    const fileConfig = JSON.parse(fileContent);
    config = { ...config, ...fileConfig };
  } catch (error) {
    // ファイルが存在しない場合は無視
  }
  
  // 環境変数で上書き
  if (process.env.OUTLOOK_AGENT_TIMEZONE) {
    config.timezone = process.env.OUTLOOK_AGENT_TIMEZONE;
  }
  if (process.env.OUTLOOK_AGENT_MODEL) {
    config.model = process.env.OUTLOOK_AGENT_MODEL;
  }
  
  // バリデーション
  return ConfigSchema.parse(config);
}

/**
 * 設定を保存する
 */
export async function saveConfig(config: Partial<Config>): Promise<void> {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  
  // ディレクトリを作成
  await fs.mkdir(configDir, { recursive: true });
  
  // 既存の設定を読み込み
  const currentConfig = await loadConfig();
  
  // マージして保存
  const newConfig = { ...currentConfig, ...config };
  await fs.writeFile(
    configPath,
    JSON.stringify(newConfig, null, 2),
    'utf-8'
  );
}

/**
 * データ保存用のベースディレクトリを取得
 */
export function getDataDir(subdir?: string): string {
  const baseDir = path.join(homedir(), '.outlook-agent');
  if (subdir) {
    return path.join(baseDir, subdir);
  }
  return baseDir;
}

/**
 * 決定ログの保存先を取得
 */
export function getDecisionsDir(): string {
  return getDataDir('decisions');
}

/**
 * キャッシュディレクトリを取得
 */
export function getCacheDir(): string {
  return getDataDir('cache');
}