import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsInt, IsString, Length, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import type { StoryStatus } from '@spm/shared';

export class TitleDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @Length(1, 200) title!: string;
}
export class RevisionDto {
  @IsInt() @Min(0) revision!: number;
}
export class EditNodeDto extends RevisionDto {
  @ValidateIf((_o, v) => v !== undefined) @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @Length(1, 200) title?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsInt() @Min(0) @Max(1000000) sortOrder?: number;
}
export class CreateEpicDto extends TitleDto {
  @IsInt() @Min(1) goalId!: number;
}
export class CreateStoryDto extends TitleDto {
  @IsInt() @Min(1) epicId!: number;
  @ValidateIf((_o, v) => v !== undefined) @IsString() @MaxLength(10000) description?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsString() @MaxLength(10000) acceptanceCriteria?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsArray() @ArrayMaxSize(1000) @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) requirementIds?: number[];
}
export class EditStoryDto extends RevisionDto {
  @ValidateIf((_o, v) => v !== undefined) @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @Length(1, 200) title?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsString() @MaxLength(10000) description?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsString() @MaxLength(10000) acceptanceCriteria?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsArray() @ArrayMaxSize(1000) @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) requirementIds?: number[];
}
export class MoveStoryDto extends RevisionDto {
  @IsInt() @Min(1) epicId!: number;
  // Zero-based insertion index after removing the moving card.
  @IsInt() @Min(0) @Max(1000000) position!: number;
}
export class StoryStatusDto extends RevisionDto {
  @IsIn(['TODO', 'IN_PROGRESS', 'DONE']) status!: StoryStatus;
}
