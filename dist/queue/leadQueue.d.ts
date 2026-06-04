import { Queue } from 'bullmq';
import Redis from 'ioredis';
export declare const connection: Redis;
export declare const leadQueue: Queue<any, any, string, any, any, string>;
export interface LeadPayload {
    company_name: string;
    source: string;
    website?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    location?: string | null;
    rating?: number | null;
    review_count?: string | null;
    reviewCount?: number | null;
    industry?: string | null;
    company_size?: string | null;
    employeeCount?: string | null;
    category?: string | null;
    description?: string | null;
    founded?: string | number | null;
    linkedin_url?: string | null;
    detail_url?: string | null;
    scraped_at?: number | null;
    capturedAt?: number | null;
    metadata?: Record<string, unknown> | null;
    name?: string;
}
export interface LeadJob {
    lead: LeadPayload;
    userId: string;
    addedAt: number;
}
export declare function addBatch(leads: LeadPayload[], userId: string): Promise<string[]>;
export declare function closeQueue(): Promise<void>;
//# sourceMappingURL=leadQueue.d.ts.map