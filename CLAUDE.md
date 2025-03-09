# CLAUDE.md - Guidance for Claude Code

## Build & Development Commands
- `bun run dev` - Development mode with hot reloading (TypeScript compilation + watch mode)
- `bun run start` - Quick start using CommonJS version (no build step, fastest startup)
- `bun run build` - Build all components (main, preload, renderer)

## Test Commands
- `bun run test` - Run all Jest tests
- `npx jest path/to/test.test.ts` - Run single test file

## Code Style Guidelines
- **Components**: Use functional components with typed props (React.FC)
- **Naming**: camelCase for variables/functions, PascalCase for components/types
- **Imports**: React first, then libraries, then local imports
- **Types**: Define interfaces for props at component level
- **Styling**: Use Emotion CSS-in-JS with component-scoped styles
- **Structure**: Components in dedicated folders by functionality
- **Error Handling**: Include error properties in result interfaces

## Project Structure
- Electron app with main/preload/renderer processes
- React for UI components
- TypeScript with strict mode enabled
- Jest for testing with mocks in `__mocks__` directory