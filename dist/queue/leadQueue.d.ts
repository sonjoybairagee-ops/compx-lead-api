import { Queue } from 'bullmq';
import Redis from 'ioredis';
export declare const connection: Redis;
export declare const leadQueue: Queue<any, any, string, any, any, string>;
export interface LeadPayload {
    source: string;
    name: string;
    website?: string | null;
    phone?: string | null;
    location?: string | null;
    rating?: number | null;
    reviewCount?: number | null;
    industry?: string | null;
    employeeCount?: string | null;
    linkedin_url?: string | null;
    capturedAt?: number | null;
}
export interface LeadJob {
    lead: LeadPayload;
    userId: string;
    addedAt: number;
}
export declare function addBatch(leads: LeadPayload[], userId: string): Promise<string[]>;
//# sourceMappingURL=leadQueue.d.ts.map