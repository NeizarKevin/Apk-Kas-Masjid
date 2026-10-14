export type Fund = 'MASJID' | 'PHBI';
export type Code = 'K1' | 'K2' | 'K3';
export interface Baseline { date: string; amount: number; holders: Record<Code, number | null> }
export interface Input { id: string; fund: Fund; type: 'in' | 'out'; code: Code; date: string; description: string; amount: number }
export interface Transaction extends Omit<Input, 'id'> {
  meta: (Input & {createdAt: string; afterSync: boolean; checkpointKey: string; reportBaselineKey: string}) | null;
  sheetId: number; sheetTitle: string; row: number;
}
export interface Report {
  mode: 'NEW_PERIOD'; openingDate: string; opening: number; startDate: string; latest: string;
  income: number; expense: number; net: number; ending: number; incomeCount: number; expenseCount: number;
  incoming: Transaction[]; outgoing: Transaction[];
  months: {key: string; label: string; income: number; expense: number; ending: number}[];
}
export interface Reconciliation {ok: boolean; date: string; book: number; actual: number; difference: number}
export interface Status {state: 'PUBLISHED' | 'UNCHANGED' | 'BLOCKED' | 'ERROR' | 'SETUP' | 'READY'; message: string; updatedAt?: string; reconciliation?: Reconciliation}
// Google REST schema fragments. Arbitrary formatting is passed through unchanged.
export type GoogleObject = Record<string, any>;
export interface Snapshot {id: number; title: string; index: number; rows: any[][]; notes: string[][]; cells: GoogleObject[][]; journal?: boolean; fund?: Fund}
export interface Source {book: GoogleObject; journal: Snapshot; phbi: Snapshot; transactions: Transaction[]; phbiTransactions: Transaction[]; checkpoints: Record<Fund, Baseline>; report: Report; reconciliation: Reconciliation}
export interface Config {
  demo: boolean; origin: string; port: number; stateDir: string; owner: string;
  clientId: string; clientSecret: string; encryptionKey: string; automatic: boolean;
  sourceId: string; reportId: string; pdfId: string; previewId: string; archiveId: string;
  journalId: number; phbiId: number; syncId: number; reportSheetIds: number[];
  baseline: Baseline; phbiBaseline: Baseline;
}
export interface Adapter {
  source(): Promise<Source>;
  verifyTargets(): Promise<void>;
  append(source: Source, tx: Input): Promise<void>;
  extendFilter(saved: Transaction): Promise<void>;
  render(report: Report): Promise<Buffer>;
  publish(bytes: Buffer, preview: boolean): Promise<string>;
}
