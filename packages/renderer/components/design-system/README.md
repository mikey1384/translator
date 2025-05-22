# Design System

This design system provides a consistent, reusable set of UI components and design tokens for the translator application.

## Core Principles

- **Consistency**: All components follow the same design patterns and use shared tokens
- **Accessibility**: Components are built with accessibility in mind (ARIA labels, keyboard navigation, focus management)
- **Performance**: Minimal CSS-in-JS footprint with efficient styling
- **Developer Experience**: Simple, predictable APIs with TypeScript support

## Design Tokens

### Spacing

```typescript
import { spacing } from './design-system/tokens';

// Usage: spacing.md = '0.75rem' (12px)
```

### Colors

Colors are imported from the main styles file to maintain theme consistency.

### Typography

```typescript
import { fontSize, fontWeight, lineHeight } from './design-system/tokens';
```

### Component Sizes

```typescript
import { componentSizes } from './design-system/tokens';

// Pre-defined sizes for buttons, inputs, etc.
```

## Components

### Button

The unified button component replaces all previous button variants.

**Before:**

```tsx
// Multiple different button components
<Button variant="primary" />
<IconButton variant="primary" icon={<Icon />} />
<FileInputButton onClick={handler} />
```

**After:**

```tsx
import { Button, FileButton } from './design-system';

// Standard button
<Button variant="primary" size="md">Click me</Button>

// Button with icons
<Button leftIcon={<Icon />} variant="secondary">With Icon</Button>

// File selection button
<FileButton onFileSelect={handleFileSelect}>Select File</FileButton>
```

**Props:**

- `variant`: 'primary' | 'secondary' | 'text' | 'danger' | 'success' | 'link'
- `size`: 'sm' | 'md' | 'lg'
- `fullWidth`: boolean
- `isLoading`: boolean
- `leftIcon` / `rightIcon`: ReactNode
- `disabled`: boolean

### Alert

Unified alert component replaces ErrorBanner and CreditWarningBanner.

**Before:**

```tsx
<ErrorBanner message="Error occurred" onClose={handler} />
<CreditWarningBanner onSettingsClick={handler} />
```

**After:**

```tsx
import { Alert } from './design-system';

<Alert variant="error" onClose={handler}>
  Error occurred
</Alert>

<Alert variant="warning">
  No credits available. <a onClick={handler}>Settings</a>
</Alert>
```

**Props:**

- `variant`: 'info' | 'success' | 'warning' | 'error'
- `title`: string (optional)
- `onClose`: function (optional, shows close button)
- `children`: ReactNode

### FileButton

Specialized button for file operations.

```tsx
import { FileButton } from './design-system';

<FileButton onFileSelect={handleFileSelect} disabled={isLoading} size="lg">
  Select Video File
</FileButton>;
```

## Migration Guide

### Step 1: Replace Button Components

**Old Components → New Component**

- `Button.tsx` → `design-system/Button`
- `IconButton.tsx` → `design-system/Button` (with `leftIcon` prop)
- `FileInputButton.tsx` → `design-system/FileButton`

### Step 2: Replace Alert Components

**Old Components → New Component**

- `ErrorBanner.tsx` → `design-system/Alert` (variant="error")
- `CreditWarningBanner.tsx` → `design-system/Alert` (variant="warning")

### Step 3: Use Design Tokens

Replace hardcoded values with design tokens:

```tsx
// Before
const styles = css`
  padding: 12px 16px;
  border-radius: 6px;
  margin-bottom: 16px;
`;

// After
import { spacing, borderRadius } from './design-system/tokens';

const styles = css`
  padding: ${spacing.md} ${spacing.lg};
  border-radius: ${borderRadius.md};
  margin-bottom: ${spacing.lg};
`;
```

## Benefits

### Before Refactoring:

- 5 different button components with inconsistent APIs
- 3 different alert/banner components
- Hardcoded styling values throughout codebase
- Inconsistent spacing, colors, and behavior

### After Refactoring:

- ✅ **1 unified Button component** with all functionality
- ✅ **1 unified Alert component** for all messaging
- ✅ **Consistent design tokens** across all components
- ✅ **Accessible by default** with proper ARIA attributes
- ✅ **TypeScript support** with full type safety
- ✅ **Smaller bundle size** through component consolidation
- ✅ **Easier maintenance** with centralized styling

## Future Extensions

The design system is designed to be extensible:

1. **Input Components**: Unified form inputs with consistent styling
2. **Modal System**: Consistent modal/dialog components
3. **Progress Components**: Unified progress indicators
4. **Navigation**: Consistent navigation patterns
5. **Layout Components**: Grid, Stack, Container utilities

## Usage Examples

```tsx
import {
  Button,
  Alert,
  FileButton,
  spacing,
  borderRadius,
} from './components/design-system';

function MyComponent() {
  return (
    <div>
      {/* Alerts */}
      <Alert variant="warning" title="Warning">
        This is a warning message with a <a href="#">link</a>.
      </Alert>

      {/* Buttons */}
      <Button
        variant="primary"
        size="md"
        isLoading={loading}
        leftIcon={<SaveIcon />}
      >
        Save Changes
      </Button>

      <FileButton onFileSelect={handleSelect}>Choose File</FileButton>

      {/* Using design tokens */}
      <div
        css={css`
          padding: ${spacing.lg};
          border-radius: ${borderRadius.md};
        `}
      >
        Content with consistent spacing
      </div>
    </div>
  );
}
```
