import { Queue } from 'bullmq';
import Redis from 'ioredis';
export declare const connection: Redis;
export declare const leadQueue: Queue<any, any, string, any, any, string>;
export interface LeadPayload {
    source: string;
    name: string;
    website?: string;
    phone?: string;
    location?: string;
    rating?: number;
    reviewCount?: number;
    industry?: string;
    employeeCount?: string;
    linkedin_url?: string;
    capturedAt?: number;
}
export interface LeadBatchJob {
    leads: LeadPayload[];
    userId: string;
    addedAt: number;
}
export declare function addBatch(leads: LeadPayload[], userId: string): Promise<string | undefined>;
//# sourceMappingURL=leadQueue.d.ts.map