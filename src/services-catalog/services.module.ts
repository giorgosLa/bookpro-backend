import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { ServicesCatalogController } from './services.controller';
import { ServicesCatalogService } from './services.service';

@Module({
  controllers: [CategoriesController, ServicesCatalogController],
  providers: [CategoriesService, ServicesCatalogService],
  exports: [ServicesCatalogService, CategoriesService],
})
export class ServicesCatalogModule {}
