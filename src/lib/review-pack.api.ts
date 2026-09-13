import { apiClient } from './api';
import type { SubjectKind } from './reportSubject';

/**
 * Client for the Automated Client Review Pack backend — spec §66-67.
 *
 * All figures on a ReviewPack come from the app's own PerformanceEngine and
 * analysis; this module only moves that data and the AI/template-generated
 * prose to and from the API, exactly as every other `*.api.ts` module in this
 * codebase does for its own feature.
 */

export type CommentaryStatus = 'DRAFT' | 'GENERATED' | 'EDITED' | 'APPROVED' | 'FAILED';

export interface ReviewPack {
  id: string;
  subjectType: 'CLIENT' | 'FAMILY';
  subjectId: string;
  market: string;
  periodCode: string;
  periodStart: string;
  periodEnd: string;

  benchmarkCode?: string | null;
  portfolioValue?: number | null;
  portfolioReturn?: number | null;
  benchmarkReturn?: number | null;
  difference?: number | null;

  headline?: string | null;
  portfolioCommentary?: string | null;
  macroCommentary?: string | null;
  positioningCommentary?: string | null;
  keyPoints: string[];

  dataQuality: 'HIGH' | 'MEDIUM' | 'LOW';
  warnings: string[];

  status: CommentaryStatus;
  aiProvider?: string | null;
  aiModel?: string | null;

  generatedAt?: string | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
}

function subjectTypeParam(kind: SubjectKind): 'client' | 'family' {
  return kind;
}

export const reviewPackApi = {
  async generate(kind: SubjectKind, subjectId: string, periodCode: string, regenerate = false): Promise<ReviewPack> {
    const res = await apiClient.getClient().post<ReviewPack>('/review-packs/generate', {
      subjectType: subjectTypeParam(kind),
      subjectId,
      periodCode,
      regenerate,
    });
    return res.data;
  },

  async get(id: string): Promise<ReviewPack> {
    const res = await apiClient.getClient().get<ReviewPack>(`/review-packs/${id}`);
    return res.data;
  },

  async editCommentary(
    id: string,
    edits: { portfolioCommentary?: string; macroCommentary?: string; positioningCommentary?: string },
  ): Promise<ReviewPack> {
    const res = await apiClient.getClient().patch<ReviewPack>(`/review-packs/${id}/commentary`, edits);
    return res.data;
  },

  async approve(id: string): Promise<ReviewPack> {
    const res = await apiClient.getClient().post<ReviewPack>(`/review-packs/${id}/approve`);
    return res.data;
  },

  async regenerate(id: string): Promise<ReviewPack> {
    const res = await apiClient.getClient().post<ReviewPack>(`/review-packs/${id}/regenerate`);
    return res.data;
  },

  /** Downloads the approved (or draft) PDF and triggers a browser save. */
  async downloadPdf(id: string, filename: string): Promise<void> {
    const res = await apiClient.getClient().get(`/review-packs/${id}/pdf`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
};
