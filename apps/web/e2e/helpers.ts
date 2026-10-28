import { expect, type Page } from '@playwright/test'

export async function submitPrompt(
  page: Page,
  desktop: boolean,
): Promise<void> {
  await page.getByRole('button', { name: 'Unfold', exact: true }).click()
  if (!desktop) return

  const presenter = page.getByTestId('presenter')
  await expect(presenter).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Exit', exact: true }).click()
  await expect(presenter).toHaveCount(0)
}
