import { randomUUID } from 'node:crypto'
import * as schema from '@main/db/schema'
import { roadmapItems } from '@main/db/schema'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'
import { runIdeaToTodoUpdate } from './store'

function testDb() {
  const sqlite = new Database(':memory:')
  const database = drizzle(sqlite, { schema })
  migrate(database, { migrationsFolder: 'drizzle' })
  return database
}

function insert(db: ReturnType<typeof testDb>, status: string) {
  const now = new Date()
  const id = randomUUID()
  db.insert(roadmapItems)
    .values({
      id,
      title: 't',
      description: '',
      category: 'wow',
      status,
      priority: 'medium',
      claudePrompt: '',
      position: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return id
}

describe('runIdeaToTodoUpdate', () => {
  it('rewrites idea rows to todo and leaves others untouched', () => {
    const db = testDb()
    const ideaId = insert(db, 'idea')
    const plannedId = insert(db, 'planned')

    const changed = runIdeaToTodoUpdate(db)

    expect(changed).toBe(1)
    expect(db.select().from(roadmapItems).where(eq(roadmapItems.id, ideaId)).get()?.status).toBe(
      'todo',
    )
    expect(db.select().from(roadmapItems).where(eq(roadmapItems.id, plannedId)).get()?.status).toBe(
      'planned',
    )
  })

  it('is a no-op when there are no idea rows', () => {
    const db = testDb()
    insert(db, 'todo')
    expect(runIdeaToTodoUpdate(db)).toBe(0)
  })
})
