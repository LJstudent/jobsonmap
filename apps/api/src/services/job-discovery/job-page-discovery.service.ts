import {
  discoverByHeuristics,
  type JobPageDiscoveryResult,
} from './heuristic-discovery.service';

export { type JobPageDiscoveryResult } from './heuristic-discovery.service';

export class JobPageDiscoveryService {
  async discover(website: string): Promise<JobPageDiscoveryResult> {
    return discoverByHeuristics(website);
  }
}
