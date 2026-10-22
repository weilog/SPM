import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import type { Priority, StoryStatus } from "@spm/shared";
export class TaskRevisionDto {
  @ValidateIf((_o, v) => v !== undefined) @IsInt() @Min(0) revision?: number;
}
export class EditTaskDto extends TaskRevisionDto {
  @ValidateIf((_o, v) => v !== undefined)
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(1, 200)
  title?: string;
  @ValidateIf((_o, v) => v !== undefined)
  @IsString()
  @MaxLength(10000)
  description?: string;
  @ValidateIf((_o, v) => v !== undefined && v !== null)
  @IsInt()
  @Min(1)
  assigneeUserId?: number | null;
  @ValidateIf((_o, v) => v !== undefined)
  @IsIn(["URGENT", "HIGH", "MEDIUM", "LOW"])
  priority?: Priority;
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(1000)
  @IsInt({ each: true })
  @Min(1, { each: true })
  storyIds?: number[];
  @ValidateIf((_o, v) => v !== undefined)
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  planIds?: string[];
}
export class TaskStatusDto extends TaskRevisionDto {
  @IsIn(["TODO", "IN_PROGRESS", "DONE"]) status!: StoryStatus;
}
export class TaskProgressDto extends TaskRevisionDto {
  @IsInt() @Min(0) @Max(99) progress!: number;
}
