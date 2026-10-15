import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { TypeOrmModule } from '@nestjs/typeorm';
import { existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { BrainModule } from './brain/brain.module';
import { ENTITIES } from './registry/entities';
import { RegistryController } from './registry/registry.controller';
import { RegistryService } from './registry/registry.service';
import { SourcesService } from './sources/sources.service';
import { SpecBuilderService } from './spec/spec-builder.service';
import { ValidatorService } from './spec/validator.service';

const config = ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] });
const frontend = resolve(process.env.FRONTEND_DIST ?? '../frontend/dist/frontend/browser');

function database() {
  const file = (process.env.DB_FILE ?? './data/registry.sqlite').trim();
  if (!file || file === ':memory:') return { type: 'sqljs' as const, synchronize: true, entities: ENTITIES };
  const location = resolve(file);
  mkdirSync(dirname(location), { recursive: true });
  return { type: 'sqljs' as const, location, autoSave: true, synchronize: true, entities: ENTITIES };
}

@Module({
  imports: [
    config,
    TypeOrmModule.forRootAsync({ useFactory: database }),
    TypeOrmModule.forFeature(ENTITIES),
    BrainModule,
    ...(existsSync(frontend) ? [ServeStaticModule.forRoot({ rootPath: frontend, exclude: ['/api/{*path}'] })] : []),
  ],
  controllers: [RegistryController],
  providers: [SourcesService, SpecBuilderService, ValidatorService, RegistryService],
})
export class AppModule {}
