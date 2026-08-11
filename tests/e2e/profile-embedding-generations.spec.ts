import { expect, test } from "@playwright/test";
import postgres from "postgres";

const ownerId = "playwright-profile-generation-user";
const embeddingModel = "sentence-transformers/all-MiniLM-L6-v2";

function database() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
  return postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
}

test.afterEach(async () => {
  const sql = database();
  try {
    await sql`delete from profiles where owner_id = ${ownerId}`;
  } finally {
    await sql.end();
  }
});

test("ranking inputs advance the profile embedding generation", async () => {
  const sql = database();
  try {
    const [topic] = await sql<{ id: string }[]>`
      select id from taxonomy_topics order by sort_order, label limit 1
    `;
    const [paper] = await sql<{ id: string }[]>`
      select id from papers order by created_at limit 1
    `;
    if (!topic || !paper) throw new Error("Local catalog fixture is incomplete");

    await sql`insert into profiles (owner_id) values (${ownerId})`;
    const [custom] = await sql<{ id: string }[]>`
      insert into playlists (owner_id, name)
      values (${ownerId}, 'Custom') returning id
    `;
    await sql`
      insert into playlist_items (playlist_id, paper_id)
      values (${custom.id}, ${paper.id})
    `;

    let [profile] = await sql<{ generation: string }[]>`
      select embedding_input_generation::text as generation
      from profiles where owner_id = ${ownerId}
    `;
    expect(Number(profile.generation)).toBe(0);

    const [readLater] = await sql<{ id: string }[]>`
      insert into playlists (owner_id, name, is_default)
      values (${ownerId}, 'Read later', true) returning id
    `;
    await sql`
      insert into playlist_items (playlist_id, paper_id)
      values (${readLater.id}, ${paper.id})
    `;
    await sql`
      insert into favorites (owner_id, paper_id)
      values (${ownerId}, ${paper.id})
    `;
    await sql`
      insert into user_paper_interactions (owner_id, paper_id, action)
      values (${ownerId}, ${paper.id}, 'open_detail')
    `;
    await sql`
      insert into user_interests (owner_id, topic_id)
      values (${ownerId}, ${topic.id})
    `;

    [profile] = await sql<{ generation: string }[]>`
      select embedding_input_generation::text as generation
      from profiles where owner_id = ${ownerId}
    `;
    expect(Number(profile.generation)).toBe(5);
  } finally {
    await sql.end();
  }
});

test("a stale generation cannot overwrite a newer profile embedding", async () => {
  const sql = database();
  const mutationSql = database();
  try {
    const [paper] = await sql<{ id: string }[]>`
      select id from papers order by created_at limit 1
    `;
    if (!paper) throw new Error("Local catalog fixture is incomplete");

    await sql`insert into profiles (owner_id) values (${ownerId})`;
    const [initial] = await sql<{ generation: string }[]>`
      select embedding_input_generation::text as generation
      from profiles where owner_id = ${ownerId}
    `;
    const staleGeneration = Number(initial.generation);

    await sql`
      insert into user_profile_embeddings (
        owner_id, embedding, embedding_model, embedding_dimension,
        input_signature, input_generation
      ) values (
        ${ownerId}, array_fill(0.1::real, array[384])::vector,
        ${embeddingModel}, 384, 'initial', ${staleGeneration}
      )
    `;
    await mutationSql`begin`;
    let transactionOpen = true;
    let staleWrite;
    try {
      await mutationSql`
      insert into favorites (owner_id, paper_id)
      values (${ownerId}, ${paper.id})
      `;

      const staleWritePromise = sql`
      with current_generation as materialized (
        select 1 from profiles
        where owner_id = ${ownerId}
          and embedding_input_generation = ${staleGeneration}
        for update
      )
      insert into user_profile_embeddings (
        owner_id, embedding, embedding_model, embedding_dimension,
        input_signature, input_generation, generated_at
      )
      select ${ownerId}, array_fill(0.2::real, array[384])::vector,
        ${embeddingModel}, 384, 'stale', ${staleGeneration}, now()
      from current_generation
      on conflict (owner_id, embedding_model) do update
      set embedding = excluded.embedding,
          input_signature = excluded.input_signature,
          input_generation = excluded.input_generation,
          generated_at = now()
      where exists (
        select 1 from current_generation
      )
      returning input_signature
      `;

      const stateBeforeCommit = await Promise.race([
        staleWritePromise.then(() => "completed"),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve("waiting-for-profile-lock"), 50),
        ),
      ]);
      expect(stateBeforeCommit).toBe("waiting-for-profile-lock");
      await mutationSql`commit`;
      transactionOpen = false;
      staleWrite = await staleWritePromise;
    } finally {
      if (transactionOpen) {
        await mutationSql`rollback`;
      }
    }

    expect(staleWrite).toHaveLength(0);

    const [stored] = await sql<{
      input_signature: string;
      input_generation: string;
    }[]>`
      select input_signature, input_generation::text
      from user_profile_embeddings
      where owner_id = ${ownerId} and embedding_model = ${embeddingModel}
    `;
    expect(stored.input_signature).toBe("initial");
    expect(Number(stored.input_generation)).toBe(staleGeneration);
  } finally {
    await mutationSql.end();
    await sql.end();
  }
});
