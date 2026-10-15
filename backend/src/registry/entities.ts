import { Column, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import { PatchOp } from '../spec/openapi.types';

export type RegistryStatus = 'undocumented' | 'review' | 'approved';
export type SpecSource = 'claude' | 'openai' | 'mock' | 'manual' | 'patch' | 'undo';
export type ProposalStatus = 'pending' | 'accepted' | 'rejected';

@Entity('api_registry')
export class ApiRegistryEntity {
  @PrimaryColumn('varchar')
  name!: string;

  @Column('varchar', { default: 'undocumented' })
  status!: RegistryStatus;

  @Column('int', { nullable: true })
  currentSpecId!: number | null;

  @Column('boolean', { default: true })
  mask!: boolean;

  @Column('int', { default: 0 })
  completed!: number;

  @Column('varchar', { nullable: true })
  startedAt!: string | null;

  @Column('varchar', { nullable: true })
  apigeeAt!: string | null;

  @Column('varchar', { nullable: true })
  splunkAt!: string | null;

  @Column('varchar', { nullable: true })
  approvedAt!: string | null;

  @Column('varchar', { nullable: true })
  approvedBy!: string | null;

  @Column('text', { nullable: true })
  approvalNote!: string | null;

  @Column('varchar')
  updatedAt!: string;
}

@Entity('api_specs')
@Index(['apiName', 'version'])
export class ApiSpecEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column('varchar')
  apiName!: string;

  @Column('int')
  version!: number;

  @Column('varchar')
  source!: SpecSource;

  @Column('text')
  content!: string;

  @Column('text')
  inputContent!: string;

  @Column('boolean')
  isValid!: boolean;

  @Column('varchar')
  createdAt!: string;
}

@Entity('validation_logs')
export class ValidationLogEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column('int')
  specId!: number;

  @Column('varchar')
  label!: string;

  @Column('boolean')
  ok!: boolean;

  @Column('text', { default: '' })
  errorMessage!: string;

  @Column('varchar')
  validatedAt!: string;
}

@Entity('discussion_messages')
export class DiscussionMessageEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column('varchar')
  apiName!: string;

  @Column('varchar')
  role!: 'user' | 'ai' | 'sys';

  @Column('text', { default: '' })
  text!: string;

  @Column('text', { nullable: true })
  error!: string | null;

  @Column('varchar')
  createdAt!: string;
}

@Entity('proposals')
export class ProposalEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column('int')
  messageId!: number;

  @Index()
  @Column('varchar')
  apiName!: string;

  @Column('varchar')
  summary!: string;

  @Column('simple-json')
  ops!: (PatchOp & { old?: unknown })[];

  @Column('varchar', { default: 'pending' })
  status!: ProposalStatus;

  @Column('varchar')
  createdAt!: string;
}

export const ENTITIES = [ApiRegistryEntity, ApiSpecEntity, ValidationLogEntity, DiscussionMessageEntity, ProposalEntity];
