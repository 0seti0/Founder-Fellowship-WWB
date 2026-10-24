import { expect, test } from '@playwright/test'

test('shows the Unfold app shell and placeholder graph', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Unfold/)
  await expect(page.getByRole('heading', { name: 'Unfold' })).toBeVisible()
  await expect(page.getByTestId('server-status')).toContainText('ok')
  await expect(
    page.locator('[data-testid="graph-canvas"] .react-flow__node'),
  ).toHaveCount(3)
})
