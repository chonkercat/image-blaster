import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

const example = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '../../.env.example')))

describe('environment configuration', () => {
  it('requires only Tripo for asset generation and leaves sound optional', () => {
    expect(example.TRIPO_API_KEY).toBe('your_tripo_key_here')
    expect(example.TRIPO_API_BASE_URL).toBe('https://openapi.tripo3d.ai/v3')
    expect(example.FAL_KEY).toBe('')
    expect(example).not.toHaveProperty('WORLD_LABS_API_KEY')
  })
})
