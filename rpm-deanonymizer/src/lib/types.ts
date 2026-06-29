export type Role = 'admin' | 'manager' | 'viewer' | 'none';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  orgId: string;
  role: Role;
  properties: string[];
  createdAt: number;
}
