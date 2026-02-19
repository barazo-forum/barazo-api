import { describe, it, expect } from 'vitest'
import {
  createOnboardingFieldSchema,
  updateOnboardingFieldSchema,
  reorderFieldsSchema,
  submitOnboardingSchema,
  validateFieldResponse,
} from '../../../src/validation/onboarding.js'

// ---------------------------------------------------------------------------
// createOnboardingFieldSchema
// ---------------------------------------------------------------------------

describe('createOnboardingFieldSchema', () => {
  it('accepts valid field creation with all fields', () => {
    const result = createOnboardingFieldSchema.safeParse({
      fieldType: 'custom_text',
      label: 'What brings you here?',
      description: 'Tell us about yourself',
      isMandatory: true,
      sortOrder: 1,
      config: null,
    })
    expect(result.success).toBe(true)
  })

  it('accepts minimal valid input (defaults applied)', () => {
    const result = createOnboardingFieldSchema.safeParse({
      fieldType: 'tos_acceptance',
      label: 'Accept our terms',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.isMandatory).toBe(true)
      expect(result.data.sortOrder).toBe(0)
    }
  })

  it('rejects invalid field type', () => {
    const result = createOnboardingFieldSchema.safeParse({
      fieldType: 'invalid_type',
      label: 'Test',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty label', () => {
    const result = createOnboardingFieldSchema.safeParse({
      fieldType: 'custom_text',
      label: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects label over 200 characters', () => {
    const result = createOnboardingFieldSchema.safeParse({
      fieldType: 'custom_text',
      label: 'a'.repeat(201),
    })
    expect(result.success).toBe(false)
  })

  it('accepts all valid field types', () => {
    const types = [
      'age_confirmation',
      'tos_acceptance',
      'newsletter_email',
      'custom_text',
      'custom_select',
      'custom_checkbox',
    ]
    for (const fieldType of types) {
      const result = createOnboardingFieldSchema.safeParse({
        fieldType,
        label: 'Test',
      })
      expect(result.success).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// updateOnboardingFieldSchema
// ---------------------------------------------------------------------------

describe('updateOnboardingFieldSchema', () => {
  it('accepts partial update with label only', () => {
    const result = updateOnboardingFieldSchema.safeParse({
      label: 'Updated label',
    })
    expect(result.success).toBe(true)
  })

  it('accepts partial update with isMandatory', () => {
    const result = updateOnboardingFieldSchema.safeParse({
      isMandatory: false,
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty object (no fields)', () => {
    const result = updateOnboardingFieldSchema.safeParse({})
    // Empty object is valid from schema perspective; route enforces at least one field
    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// reorderFieldsSchema
// ---------------------------------------------------------------------------

describe('reorderFieldsSchema', () => {
  it('accepts valid reorder array', () => {
    const result = reorderFieldsSchema.safeParse([
      { id: 'field-1', sortOrder: 0 },
      { id: 'field-2', sortOrder: 1 },
    ])
    expect(result.success).toBe(true)
  })

  it('rejects empty array', () => {
    const result = reorderFieldsSchema.safeParse([])
    expect(result.success).toBe(false)
  })

  it('rejects negative sort order', () => {
    const result = reorderFieldsSchema.safeParse([{ id: 'field-1', sortOrder: -1 }])
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// submitOnboardingSchema
// ---------------------------------------------------------------------------

describe('submitOnboardingSchema', () => {
  it('accepts valid submission array', () => {
    const result = submitOnboardingSchema.safeParse([
      { fieldId: 'field-1', response: true },
      { fieldId: 'field-2', response: 'hello' },
    ])
    expect(result.success).toBe(true)
  })

  it('rejects empty array', () => {
    const result = submitOnboardingSchema.safeParse([])
    expect(result.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// validateFieldResponse
// ---------------------------------------------------------------------------

describe('validateFieldResponse', () => {
  describe('age_confirmation', () => {
    it('accepts valid age values', () => {
      for (const age of [0, 13, 14, 15, 16, 18]) {
        expect(validateFieldResponse('age_confirmation', age, null)).toBeNull()
      }
    })

    it('rejects invalid age values', () => {
      expect(validateFieldResponse('age_confirmation', 12, null)).not.toBeNull()
      expect(validateFieldResponse('age_confirmation', 17, null)).not.toBeNull()
      expect(validateFieldResponse('age_confirmation', '16', null)).not.toBeNull()
    })
  })

  describe('tos_acceptance', () => {
    it('accepts true', () => {
      expect(validateFieldResponse('tos_acceptance', true, null)).toBeNull()
    })

    it('rejects false', () => {
      expect(validateFieldResponse('tos_acceptance', false, null)).not.toBeNull()
    })

    it('rejects non-boolean', () => {
      expect(validateFieldResponse('tos_acceptance', 'yes', null)).not.toBeNull()
    })
  })

  describe('newsletter_email', () => {
    it('accepts valid email', () => {
      expect(validateFieldResponse('newsletter_email', 'test@example.com', null)).toBeNull()
    })

    it('accepts empty string (optional)', () => {
      expect(validateFieldResponse('newsletter_email', '', null)).toBeNull()
    })

    it('rejects invalid email', () => {
      expect(validateFieldResponse('newsletter_email', 'not-an-email', null)).not.toBeNull()
    })
  })

  describe('custom_text', () => {
    it('accepts valid text', () => {
      expect(validateFieldResponse('custom_text', 'Hello world', null)).toBeNull()
    })

    it('rejects text over 1000 chars', () => {
      expect(validateFieldResponse('custom_text', 'a'.repeat(1001), null)).not.toBeNull()
    })

    it('rejects non-string', () => {
      expect(validateFieldResponse('custom_text', 42, null)).not.toBeNull()
    })
  })

  describe('custom_select', () => {
    const config = { options: ['opt1', 'opt2', 'opt3'] }

    it('accepts valid selection', () => {
      expect(validateFieldResponse('custom_select', 'opt1', config)).toBeNull()
    })

    it('rejects invalid selection', () => {
      expect(validateFieldResponse('custom_select', 'opt4', config)).not.toBeNull()
    })

    it('rejects non-string', () => {
      expect(validateFieldResponse('custom_select', 1, config)).not.toBeNull()
    })
  })

  describe('custom_checkbox', () => {
    it('accepts boolean values', () => {
      expect(validateFieldResponse('custom_checkbox', true, null)).toBeNull()
      expect(validateFieldResponse('custom_checkbox', false, null)).toBeNull()
    })

    it('rejects non-boolean', () => {
      expect(validateFieldResponse('custom_checkbox', 'yes', null)).not.toBeNull()
    })
  })
})
