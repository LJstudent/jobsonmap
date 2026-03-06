import {
  type GetAllBusinessesQuery,
  type GetAllBusinessesResult,
} from "./businesses.types";
import { BusinessesRepository } from "./businesses.repository";

export class BusinessesService {
  constructor(private readonly businessesRepository: BusinessesRepository) {}

  async getAllBusinesses(query: GetAllBusinessesQuery): Promise<GetAllBusinessesResult> {
    return this.businessesRepository.getAll(query);
  }
}
