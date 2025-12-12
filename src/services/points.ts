import { Env } from '../types/env';
import { UserPoints, LeaderboardEntry } from '../types/shared';

const POINTS_PER_TRADE = 10;
const POINTS_PER_USD_VOLUME = 1;
const STREAK_MULTIPLIER = 1.5;

export class PointsService {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  private getWeekStart(): number {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const diff = now.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const weekStart = new Date(now.setUTCDate(diff));
    weekStart.setUTCHours(0, 0, 0, 0);
    return Math.floor(weekStart.getTime() / 1000);
  }

  async awardTradePoints(userId: string, volumeUsd: number): Promise<number> {
    const weekStart = this.getWeekStart();
    const basePoints = POINTS_PER_TRADE + Math.floor(volumeUsd * POINTS_PER_USD_VOLUME);

    const existing = await this.env.DB.prepare(`
      SELECT * FROM user_points WHERE user_id = ?
    `).bind(userId).first<any>();

    if (!existing) {
      await this.env.DB.prepare(`
        INSERT INTO user_points (user_id, total_points, trade_count, volume_usd, weekly_points, week_start)
        VALUES (?, ?, 1, ?, ?, ?)
      `).bind(userId, basePoints, volumeUsd, basePoints, weekStart).run();
      return basePoints;
    }

    let weeklyPoints = existing.weekly_points;
    if (existing.week_start !== weekStart) {
      weeklyPoints = 0;
    }

    const multiplier = existing.trade_count >= 10 ? STREAK_MULTIPLIER : 1;
    const earnedPoints = Math.floor(basePoints * multiplier);

    await this.env.DB.prepare(`
      UPDATE user_points 
      SET total_points = total_points + ?,
          trade_count = trade_count + 1,
          volume_usd = volume_usd + ?,
          weekly_points = ? + ?,
          week_start = ?,
          updated_at = unixepoch()
      WHERE user_id = ?
    `).bind(
      earnedPoints,
      volumeUsd,
      weeklyPoints,
      earnedPoints,
      weekStart,
      userId
    ).run();

    return earnedPoints;
  }

  async getUserPoints(userId: string): Promise<UserPoints | null> {
    const weekStart = this.getWeekStart();
    
    const result = await this.env.DB.prepare(`
      SELECT * FROM user_points WHERE user_id = ?
    `).bind(userId).first<any>();

    if (!result) return null;

    const rank = await this.env.DB.prepare(`
      SELECT COUNT(*) + 1 as rank FROM user_points 
      WHERE total_points > (SELECT total_points FROM user_points WHERE user_id = ?)
    `).bind(userId).first<{ rank: number }>();

    return {
      userId: result.user_id,
      totalPoints: result.total_points,
      tradeCount: result.trade_count,
      volumeUsd: result.volume_usd,
      weeklyPoints: result.week_start === weekStart ? result.weekly_points : 0,
      weekStart,
      rank: rank?.rank,
    };
  }

  async getLeaderboard(limit = 20, weekly = false): Promise<LeaderboardEntry[]> {
    const weekStart = this.getWeekStart();
    
    let query: string;
    if (weekly) {
      query = `
        SELECT up.*, u.public_key,
               ROW_NUMBER() OVER (ORDER BY up.weekly_points DESC) as rank
        FROM user_points up
        JOIN users u ON up.user_id = u.id
        WHERE up.week_start = ?
        ORDER BY up.weekly_points DESC
        LIMIT ?
      `;
    } else {
      query = `
        SELECT up.*, u.public_key,
               ROW_NUMBER() OVER (ORDER BY up.total_points DESC) as rank
        FROM user_points up
        JOIN users u ON up.user_id = u.id
        ORDER BY up.total_points DESC
        LIMIT ?
      `;
    }

    const results = weekly
      ? await this.env.DB.prepare(query).bind(weekStart, limit).all<any>()
      : await this.env.DB.prepare(query).bind(limit).all<any>();

    return results.results.map((row: any) => ({
      rank: row.rank,
      userId: row.user_id,
      publicKey: row.public_key,
      points: weekly ? row.weekly_points : row.total_points,
      tradeCount: row.trade_count,
      volumeUsd: row.volume_usd,
    }));
  }
}
