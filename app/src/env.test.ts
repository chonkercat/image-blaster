import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

const example = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '../../.env.example')))

describe('environment configuration', () => {
  it('defaults to Tripo and includes configuration for the original stack', () => {
    expect(example.ASSET_GENERATION_STACK).toBe('tripo')
    expect(example.TRIPO_API_KEY).toBe('your_tripo_key_here')
    expect(example.TRIPO_API_BASE_URL).toBe('https://openapi.tripo3d.ai/v3')
    expect(example.FAL_KEY).toBe('')
    expect(example.WORLD_LABS_API_KEY).toBe('')
    expect(example.WORLD_LABS_MODEL).toBe('marble-1.1')
    expect(example).not.toHaveProperty('ASSET_IMAGE_EDIT_PROVIDER')
    expect(example).not.toHaveProperty('ASSET_3D_PROVIDER')
    expect(example).not.toHaveProperty('ASSET_WORLD_PROVIDER')
  })
})
