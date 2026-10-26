export type TrustProof = {
  id: string; title: string; summary: string; category: string; amountInr: number;
  commitment: string; publicImage?: string; demo?: boolean; grade: number; checks: string[]; status: 'review' | 'flagged' | 'approved';
  yes: number; no: number; final: boolean; voted: boolean; createdAt: string;
  demoVotes?:number;walletVotes?:number;
  verification?: { model: string; status: string; privacy: string; checks: { amountMatches: boolean; categoryMatches: boolean; readable: boolean; suspicious: boolean; identityPresent: boolean }; limitation: string };
};
export type TrustEvent = { id: string; type: string; title: string; detail: string; amountInr?: number; testEth?:string; transaction?:string; createdAt: string };
export type TrustNgo = {
  id: string; name: string; country: string; walletAddress: string;
  campaign: { id: string; name: string; category: string; budgetInr: number; fundraising: { targetInr: number; raisedInr: number; story: string; status: string; requestedAt: string } };
  score: number; frozen: boolean; hold: { reason: string; proofId: string; createdAt: string; scope: string } | null;
  allowanceInr: number; exposureInr: number; allowanceLeftInr: number;
  totalSpentInr:number; approvedSpendInr:number; outstandingInr:number;
  votingPolicy:{minimumReviews:number;approvalPercent:number;positiveScore:number;negativeScore:number;duplicateScore:number};
  proofs: TrustProof[]; events: TrustEvent[]; scoreHistory: { id: string; score: number; delta: number; reason: string; createdAt: string }[];
  reputation: { approved: number; open: number; flagged: number }; demo: true;
  blockchain:{contract:string;campaignId:string|null;deploymentTx:string;testEthDonated:string;donations:{transaction:string;from:string;testEth:string;createdAt:string}[]}|null;
  donor:{source:'demo'|'verified_testnet_donor';wallet:string|null}|null;
};

const base = '/api/trust';
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(base + path, { ...options, headers: { 'content-type': 'application/json', ...options?.headers }, cache: 'no-store' });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || 'Trust engine is unavailable.');
  return data;
}
const json = (body: unknown, token?: string): RequestInit => ({ method: 'POST', body: JSON.stringify(body), headers: token ? { authorization: `Bearer ${token}` } : undefined });
export const fetchTrust = (token?: string) => request<TrustNgo>('/ngos/harbor-hands', token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
export const createDemoDonor = (amountInr: number) => request<{ donorId: string; token: string; amountInr: number; demo: true }>('/demo-donations', json({ amountInr, ngoId: 'harbor-hands' }));
export const requestFunding = (input: { name: string; story: string; targetInr: number }) => request<TrustNgo>('/ngos/harbor-hands/request', json(input));
export const recordAdvance = (amountInr: number) => request<TrustNgo>('/ngos/harbor-hands/advances', json({ amountInr }));
export const submitTrustProof = (input: { vendor: string; invoice: string; amountInr: number; title: string; summary: string; documentHash: string; publicImage?: string; evidenceId?: string; privacyReviewed?: boolean; recordPayment?:boolean }) => request<{ duplicate: boolean; state: TrustNgo }>('/ngos/harbor-hands/proofs', json(input));
export const voteProof = (proofId: string, support: boolean, token: string) => request<TrustNgo>(`/ngos/harbor-hands/proofs/${encodeURIComponent(proofId)}/votes`, json({ support }, token));
export const runTrustAttack = () => request<{ duplicate: boolean; state: TrustNgo }>('/ngos/harbor-hands/demo-attack', json({}));
export const resetTrust = () => request<TrustNgo>('/demo/reset', json({}));
