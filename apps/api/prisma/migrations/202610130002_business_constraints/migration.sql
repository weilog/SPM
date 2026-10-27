ALTER TABLE "Task" ADD CONSTRAINT "task_todo_only" CHECK ("status" = 'TODO');
ALTER TABLE "Task" ADD CONSTRAINT "task_title_not_blank" CHECK (length(btrim("title")) > 0);
ALTER TABLE "Project" ADD CONSTRAINT "project_name_not_blank" CHECK (length(btrim("name")) > 0);

-- Lock the assignee's user row: assignment and deactivation cannot interleave.
CREATE FUNCTION spm_check_assignee() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."assigneeUserId" IS NOT NULL THEN
    PERFORM 1 FROM "User" WHERE "id" = NEW."assigneeUserId" AND "active" = true FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Assignee must be active' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER task_active_assignee BEFORE INSERT OR UPDATE OF "assigneeUserId" ON "Task"
FOR EACH ROW EXECUTE FUNCTION spm_check_assignee();

CREATE FUNCTION spm_deactivate_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."active" = false THEN
    UPDATE "Task" SET "assigneeUserId" = NULL WHERE "assigneeUserId" = NEW."id";
    DELETE FROM "Session" WHERE "userId" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_deactivation AFTER UPDATE OF "active" ON "User"
FOR EACH ROW EXECUTE FUNCTION spm_deactivate_user();

CREATE FUNCTION spm_remove_member() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Task" SET "assigneeUserId" = NULL WHERE "projectId" = OLD."projectId" AND "assigneeUserId" = OLD."userId";
  RETURN OLD;
END;
$$;
CREATE TRIGGER member_removal BEFORE DELETE ON "ProjectMember"
FOR EACH ROW EXECUTE FUNCTION spm_remove_member();
