-- GDPR Deletion Script for Socrative Users
-- This script is designed to delete user data in batches to avoid locking tables in a large database.

-- NOTE: This script expects a temp table 'ids_to_delete(user_id text)' to already exist
-- The TypeScript CLI creates this table and populates it with external IDs before running this script

DO $$
DECLARE
    -- (1) CONFIGURE THE BATCH SIZE HERE
    batch_size INT := 100; -- Number of users to delete per transaction batch

    -- Internal variables
    user_id_batch INT[];
    total_users_to_delete INT;
    deleted_count INT := 0;
BEGIN
    -- (2) Create additional temporary tables for workspace/team tracking.
    CREATE TEMP TABLE IF NOT EXISTS users_to_delete (user_id INT PRIMARY KEY);
    CREATE TEMP TABLE workspaces_to_purge (workspace_id UUID);
    CREATE TEMP TABLE workspaces_to_preserve (workspace_id UUID);
    CREATE TEMP TABLE teams_to_purge (team_id UUID);

    -- (3) Populate users_to_delete from the ids_to_delete table (created by TypeScript)
    -- Map external_ids to internal user_ids
    INSERT INTO users_to_delete (user_id)
    SELECT eu.user_id
    FROM external_users eu
    WHERE eu.external_id IN (SELECT user_id FROM ids_to_delete)
      ON CONFLICT (user_id) DO NOTHING;

    -- Get a count of users to be deleted for progress reporting.
    SELECT count(*) INTO total_users_to_delete FROM users_to_delete;
    RAISE NOTICE 'Starting deletion for % user(s).', total_users_to_delete;

    -- (4) Loop through the users_to_delete table in batches.
    LOOP
        -- Select a batch of user IDs to process.
        SELECT array_agg(user_id) INTO user_id_batch
        FROM (
               SELECT user_id FROM users_to_delete LIMIT batch_size
             ) AS t;

        -- Exit the loop if no more users are left to process.
        IF user_id_batch IS NULL OR array_length(user_id_batch, 1) = 0 THEN
            EXIT;
        END IF;

        RAISE NOTICE 'Processing batch of % user(s)...', array_length(user_id_batch, 1);

        -- (5) Start deleting data associated with the batch of user IDs.
        -- The order of deletion is critical to avoid foreign key constraint violations.

        -- Workspace related data (Logic replicated from purgeWorkspaceDataOnTeacherPurge.ts)

        -- (A) Identify workspaces to be fully purged vs. those to be preserved for this batch.
        TRUNCATE workspaces_to_purge;
        TRUNCATE workspaces_to_preserve;

        INSERT INTO workspaces_to_purge
        SELECT uw.workspace_id
        FROM user_workspaces uw
        LEFT JOIN user_workspaces other_users ON uw.workspace_id = other_users.workspace_id
            AND other_users.user_id != uw.user_id
            AND other_users.status = 1 -- 'ACTIVE'
            AND other_users.role != 0 -- 'SHADOW_USER'
        WHERE uw.user_id = ANY(user_id_batch)
        GROUP BY uw.workspace_id
        HAVING COUNT(other_users.id) = 0;

        INSERT INTO workspaces_to_preserve
        SELECT uw.workspace_id
        FROM user_workspaces uw
        WHERE uw.user_id = ANY(user_id_batch) AND uw.workspace_id NOT IN (SELECT workspace_id FROM workspaces_to_purge);

        -- (B) Handle shared/preserved workspaces: re-assign content and transfer ownership.
        DECLARE
            shadow_user_workspace_id UUID;
        BEGIN
            SELECT id INTO shadow_user_workspace_id FROM user_workspaces WHERE role = 0 -- 'SHADOW_USER' 
            LIMIT 1;

            IF shadow_user_workspace_id IS NOT NULL THEN
                -- Re-assign content to the shadow user before deleting the target user's workspace entry.
                UPDATE workspace_quizzes
                SET originally_created_by = shadow_user_workspace_id
                WHERE originally_created_by IN (SELECT id FROM user_workspaces WHERE user_id = ANY(user_id_batch) AND workspace_id IN (SELECT workspace_id FROM workspaces_to_preserve));

                UPDATE workspace_quizzes
                SET published_by = shadow_user_workspace_id
                WHERE published_by IN (SELECT id FROM user_workspaces WHERE user_id = ANY(user_id_batch) AND workspace_id IN (SELECT workspace_id FROM workspaces_to_preserve));

                DELETE FROM workspace_quiz_locks
                WHERE locked_by IN (SELECT id FROM user_workspaces WHERE user_id = ANY(user_id_batch) AND workspace_id IN (SELECT workspace_id FROM workspaces_to_preserve));
            END IF;
        END;

        -- (C) Fully purge workspaces where the deleted user was the last active member.
        DELETE FROM workspace_quiz_locks WHERE locked_by IN (SELECT id FROM user_workspaces WHERE workspace_id IN (SELECT workspace_id FROM workspaces_to_purge));
        DELETE FROM workspace_quizzes WHERE workspace_id IN (SELECT workspace_id FROM workspaces_to_purge);
        DELETE FROM workspace_folders WHERE workspace_id IN (SELECT workspace_id FROM workspaces_to_purge);
        DELETE FROM workspace_codes WHERE workspace_id IN (SELECT workspace_id FROM workspaces_to_purge);
        DELETE FROM user_workspaces WHERE workspace_id IN (SELECT workspace_id FROM workspaces_to_purge);
        DELETE FROM workspaces WHERE id IN (SELECT workspace_id FROM workspaces_to_purge);

        -- (D) Finally, delete the user's link to any preserved workspaces.
        DELETE FROM user_workspaces WHERE user_id = ANY(user_id_batch) AND workspace_id IN (SELECT workspace_id FROM workspaces_to_preserve);

        -- Activity and Response Data
        DELETE FROM student_responses_answer_selection WHERE student_response_id IN (SELECT id FROM student_responses WHERE activity_instance_id IN (SELECT id FROM common_activityinstance WHERE started_by_id = ANY(user_id_batch)));
        DELETE FROM student_responses_text_answer WHERE student_response_id IN (SELECT id FROM student_responses WHERE activity_instance_id IN (SELECT id FROM common_activityinstance WHERE started_by_id = ANY(user_id_batch)));
        DELETE FROM student_responses WHERE activity_instance_id IN (SELECT id FROM common_activityinstance WHERE started_by_id = ANY(user_id_batch));
        DELETE FROM activity_question_scores WHERE activity_instance_id IN (SELECT id FROM common_activityinstance WHERE started_by_id = ANY(user_id_batch));
        DELETE FROM students_studentname WHERE activity_instance_id IN (SELECT id FROM common_activityinstance WHERE started_by_id = ANY(user_id_batch));
        DELETE FROM students_activitystudent WHERE activity_instance_id IN (SELECT id FROM common_activityinstance WHERE started_by_id = ANY(user_id_batch));
        DELETE FROM common_activitysetting WHERE id IN (SELECT activitysetting_id FROM common_activityinstance_settings WHERE activityinstance_id IN (SELECT id FROM common_activityinstance WHERE started_by_id = ANY(user_id_batch)));
        DELETE FROM common_activityinstance_settings WHERE activityinstance_id IN (SELECT id FROM common_activityinstance WHERE started_by_id = ANY(user_id_batch));
        DELETE FROM common_activityinstance WHERE started_by_id = ANY(user_id_batch);

        -- Quiz, Question, and Folder Data
        -- More robustly delete quiz/question/answer resources by joining tables, similar to purgeTeacher.
        DELETE FROM quizzes_answer_resources qar USING quizzes_answer qa
        WHERE qa.id = qar.answer_id AND qa.created_by_id = ANY(user_id_batch);

        DELETE FROM quizzes_question_resources qqr USING quizzes_question qq
        WHERE qq.question_id = qqr.question_id AND qq.created_by_id = ANY(user_id_batch);

        DELETE FROM quizzes_answer WHERE created_by_id = ANY(user_id_batch);
        DELETE FROM quizzes_question WHERE created_by_id = ANY(user_id_batch);
        DELETE FROM quizzes_standard WHERE quiz_id IN (SELECT id FROM quizzes_quiz WHERE created_by_id = ANY(user_id_batch));
        DELETE FROM quizzes_imports WHERE quiz_id IN (SELECT id FROM quizzes_quiz WHERE created_by_id = ANY(user_id_batch));
        DELETE FROM quizzes_quiz WHERE created_by_id = ANY(user_id_batch);
        DELETE FROM folders WHERE user_id = ANY(user_id_batch);

        -- Room and Roster Data
        DELETE FROM students_student_rosters WHERE roster_id IN (SELECT id FROM rooms_roster WHERE room_id IN (SELECT id FROM rooms_room WHERE created_by_id = ANY(user_id_batch)));
        DELETE FROM rooms_roster WHERE room_id IN (SELECT id FROM rooms_room WHERE created_by_id = ANY(user_id_batch));
        DELETE FROM rooms_roomcode WHERE room_id IN (SELECT id FROM rooms_room WHERE created_by_id = ANY(user_id_batch));
        DELETE FROM rooms_roomhistory WHERE user_id = ANY(user_id_batch);
        DELETE FROM rooms_room WHERE created_by_id = ANY(user_id_batch);
        DELETE FROM rooms_rosterfilesettings WHERE teacher_id = ANY(user_id_batch);

        -- User-specific settings and metadata
        DELETE FROM user_oauth_clients WHERE user_id = ANY(user_id_batch);
        DELETE FROM user_oauth_client_histories WHERE user_id = ANY(user_id_batch);
        DELETE FROM user_applications WHERE user_id = ANY(user_id_batch);
        DELETE FROM user_beta_flags WHERE user_id = ANY(user_id_batch);
        DELETE FROM common_partner WHERE user_id = ANY(user_id_batch);
        DELETE FROM notifications WHERE user_id = ANY(user_id_batch);
        DELETE FROM socrative_users_scoreexportsettings WHERE teacher_id = ANY(user_id_batch);
        DELETE FROM socrative_users_temptoken WHERE created_by_id = ANY(user_id_batch);
        DELETE FROM socrative_users_usersysmsg WHERE user_id = ANY(user_id_batch);

        -- License and Subscription Data
        DELETE FROM license_activations WHERE user_id = ANY(user_id_batch);
        UPDATE subscriptions SET cancel_at_end_date = true WHERE purchase_user_id = ANY(user_id_batch);
        DELETE FROM subscriptions_users WHERE user_id = ANY(user_id_batch);

        -- Teams Data
        -- Identify teams where the user is the last and only member, and is the owner.
        TRUNCATE teams_to_purge;
        INSERT INTO teams_to_purge
        SELECT tu.team_id
        FROM teams_users tu
        JOIN (
            SELECT team_id, COUNT(user_id) as member_count
            FROM teams_users
            GROUP BY team_id
        ) tc ON tu.team_id = tc.team_id
        WHERE tu.user_id = ANY(user_id_batch)
          AND tu.role = 1 -- Role is Owner
          AND tc.member_count = 1;

        -- Purge the teams identified above.
        DELETE FROM teams_users WHERE team_id IN (SELECT team_id FROM teams_to_purge);
        DELETE FROM teams WHERE id IN (SELECT team_id FROM teams_to_purge);

        -- For all other teams, just remove the user's association.
        DELETE FROM teams_users
        WHERE user_id = ANY(user_id_batch)
          AND team_id NOT IN (SELECT team_id FROM teams_to_purge);

        -- Delete media resources owned by the user.
        DELETE FROM common_mediaresource WHERE owner_id = ANY(user_id_batch);

        -- Finally, delete the user records themselves
        DELETE FROM external_users WHERE user_id = ANY(user_id_batch);
        DELETE FROM socrative_users_socrativeuser WHERE id = ANY(user_id_batch);

        -- (6) Remove the processed users from the temporary table.
        DELETE FROM users_to_delete WHERE user_id = ANY(user_id_batch);

        -- Update and report progress.
        deleted_count := deleted_count + array_length(user_id_batch, 1);
                RAISE NOTICE 'Deleted % / % users.', deleted_count, total_users_to_delete;

                -- Optional: Add a small delay to reduce load on the database.
                -- PERFORM pg_sleep(1); -- Sleeps for 1 second

    END LOOP;

    -- (7) Clean up the temporary tables.
    DROP TABLE users_to_delete;
    DROP TABLE workspaces_to_purge;
    DROP TABLE workspaces_to_preserve;
    DROP TABLE teams_to_purge;

RAISE NOTICE 'User deletion script completed.';
END;
$$;
