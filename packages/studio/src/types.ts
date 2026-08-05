/** Serializable shapes matching packages/studio/openapi.yaml */

export interface ContentTreeDoc {
  slug: string;
  sourcePath: string;
  title?: string;
}

export interface ContentTreeCollection {
  name: string;
  description?: string;
  documents: ContentTreeDoc[];
}

export interface ContentTree {
  branch: string;
  collections: ContentTreeCollection[];
}

export interface DocumentDto {
  collection: string;
  slug: string;
  sourcePath: string;
  data: Record<string, unknown>;
  body: string;
  raw: string;
}

export interface CompilationDto {
  id: string;
  branchId: string;
  gitSha: string | null;
  docCount: number;
  added: number;
  changed: number;
  removed: number;
  createdAt: string;
}

export interface CompilationList {
  compilations: CompilationDto[];
}

export interface BranchDto {
  name: string;
  parent: string | null;
  backend: string;
  status: string;
  createdAt: string;
  endpointHost: string | null;
}

export interface BranchList {
  branches: BranchDto[];
}

export interface PendingApprovalDto {
  id: string;
  branchId: string;
  functionName: string;
  input: Record<string, unknown>;
  requestedByKind: string;
  requestedById: string | null;
  correlationId: string;
  createdAt: string;
}

export interface ApprovalList {
  approvals: PendingApprovalDto[];
}
