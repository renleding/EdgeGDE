import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import { PortfolioManifest } from '../types';
import { manifestValidator } from '../validator/ManifestValidator';

// Node.js types
declare const process: { cwd(): string };

// OpenSpec change schema
export const OpenSpecChangeSchema = z.object({
  name: z.string(),
  proposal: z.object({
    why: z.string(),
    what: z.string(),
    capabilities: z.array(z.string())
  }),
  design: z.object({
    architecture: z.string(),
    data_flow: z.string(),
    file_structure: z.string()
  }).optional(),
  specs: z.record(z.object({
    requirements: z.array(z.object({
      id: z.string(),
      description: z.string(),
      scenarios: z.array(z.object({
        given: z.string(),
        when: z.string(),
        then: z.string()
      }))
    }))
  })).optional(),
  tasks: z.array(z.object({
    id: z.string(),
    description: z.string(),
    phase: z.string()
  })).optional()
});

export type OpenSpecChange = z.infer<typeof OpenSpecChangeSchema>;

export interface OpenSpecValidationResult {
  changeName: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  linkedProjects: string[];
}

export interface OpenSpecLinkResult {
  project: string;
  openspecChanges: string[];
  missingLinks: string[];
}

export class OpenSpecValidator {
  private openspecDir: string;
  private manifest: PortfolioManifest;

  constructor(openspecDir?: string) {
    this.openspecDir = openspecDir || '/Users/warren/Documents/_HQ_AI/EdgeGDE/openspec/changes';
    this.manifest = manifestValidator.getManifest();
  }

  /**
   * Validate all OpenSpec changes
   */
  validateAll(): OpenSpecValidationResult[] {
    if (!fs.existsSync(this.openspecDir)) {
      return [];
    }

    const results: OpenSpecValidationResult[] = [];
    const changeDirs = fs.readdirSync(this.openspecDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const changeName of changeDirs) {
      results.push(this.validateChange(changeName));
    }

    return results;
  }

  /**
   * Validate a single OpenSpec change
   */
  validateChange(changeName: string): OpenSpecValidationResult {
    const changePath = path.join(this.openspecDir, changeName);
    const errors: string[] = [];
    const warnings: string[] = [];
    const linkedProjects: string[] = [];

    // Check required files
    const requiredFiles = ['proposal.md', 'design.md', 'specs/', 'tasks.md'];
    for (const file of requiredFiles) {
      const filePath = path.join(changePath, file);
      if (!fs.existsSync(filePath)) {
        errors.push(`Missing required file/directory: ${file}`);
      }
    }

    // Parse proposal.md
    const proposalPath = path.join(changePath, 'proposal.md');
    if (fs.existsSync(proposalPath)) {
      const proposalContent = fs.readFileSync(proposalPath, 'utf-8');
      const proposalValidation = this.validateProposal(proposalContent);
      errors.push(...proposalValidation.errors);
      warnings.push(...proposalValidation.warnings);
    }

    // Parse design.md
    const designPath = path.join(changePath, 'design.md');
    if (fs.existsSync(designPath)) {
      const designContent = fs.readFileSync(designPath, 'utf-8');
      const designValidation = this.validateDesign(designContent);
      errors.push(...designValidation.errors);
      warnings.push(...designValidation.warnings);
    }

    // Parse specs/
    const specsDir = path.join(changePath, 'specs');
    if (fs.existsSync(specsDir)) {
      const specDirs = fs.readdirSync(specsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
      
      for (const specDir of specDirs) {
        const specPath = path.join(specsDir, specDir, 'spec.md');
        if (fs.existsSync(specPath)) {
          const specContent = fs.readFileSync(specPath, 'utf-8');
          const specValidation = this.validateSpec(specContent, specDir);
          errors.push(...specValidation.errors);
          warnings.push(...specValidation.warnings);
        }
      }
    }

    // Parse tasks.md
    const tasksPath = path.join(changePath, 'tasks.md');
    if (fs.existsSync(tasksPath)) {
      const tasksContent = fs.readFileSync(tasksPath, 'utf-8');
      const tasksValidation = this.validateTasks(tasksContent);
      errors.push(...tasksValidation.errors);
      warnings.push(...tasksValidation.warnings);
    }

    // Find linked projects
    for (const project of this.manifest.portfolio) {
      if (project.openspec) {
        // Check if project name matches change name
        const projectLower = project.project.toLowerCase().replace(/-/g, '');
        const changeLower = changeName.toLowerCase().replace(/-/g, '');
        
        if (projectLower.includes(changeLower) || changeLower.includes(projectLower)) {
          linkedProjects.push(project.project);
        }
        
        // Check aliases
        if (project.aliases) {
          for (const alias of project.aliases) {
            const aliasLower = alias.toLowerCase().replace(/-/g, '');
            if (aliasLower.includes(changeLower) || changeLower.includes(aliasLower)) {
              if (!linkedProjects.includes(project.project)) {
                linkedProjects.push(project.project);
              }
            }
          }
        }
      }
    }

    return {
      changeName,
      valid: errors.length === 0,
      errors,
      warnings,
      linkedProjects
    };
  }

  /**
   * Get OpenSpec linkage for all projects
   */
  getProjectLinks(): OpenSpecLinkResult[] {
    const results: OpenSpecLinkResult[] = [];
    const allValidation = this.validateAll();
    const changeMap = new Map(allValidation.map(v => [v.changeName, v.linkedProjects]));

    for (const project of this.manifest.portfolio) {
      if (!project.openspec) continue;

      const linked: string[] = [];
      const missing: string[] = [];

      for (const [changeName, projects] of changeMap) {
        if (projects.includes(project.project)) {
          linked.push(changeName);
        }
      }

      // Check if project has openspec=true but no linked changes
      if (linked.length === 0) {
        missing.push('No linked OpenSpec changes found');
      }

      results.push({
        project: project.project,
        openspecChanges: linked,
        missingLinks: missing
      });
    }

    return results;
  }

  /**
   * Validate proposal.md structure
   */
  private validateProposal(content: string): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for required sections
    const requiredSections = ['Why this change', 'What changes', 'Capabilities'];
    for (const section of requiredSections) {
      if (!content.includes(section)) {
        warnings.push(`Proposal missing section: ${section}`);
      }
    }

    // Check for SHALL/MUST requirements (RFC 2119)
    if (!/SHALL|MUST/.test(content)) {
      warnings.push('Proposal should use SHALL/MUST for requirements (RFC 2119)');
    }

    return { errors, warnings };
  }

  /**
   * Validate design.md structure
   */
  private validateDesign(content: string): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    const requiredSections = ['Architecture', 'Data Flow', 'File Structure'];
    for (const section of requiredSections) {
      if (!content.includes(section)) {
        warnings.push(`Design missing section: ${section}`);
      }
    }

    return { errors, warnings };
  }

  /**
   * Validate spec.md structure
   */
  private validateSpec(content: string, specName: string): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for ADDED/MODIFIED requirements
    if (!/ADDED|MODIFIED/.test(content)) {
      warnings.push(`Spec ${specName} should have ADDED/MODIFIED requirements`);
    }

    // Check for scenario blocks
    const scenarioMatches = content.match(/#### Scenario:/g);
    if (!scenarioMatches || scenarioMatches.length === 0) {
      warnings.push(`Spec ${specName} should have at least one Scenario block`);
    }

    // Check for Given/When/Then in scenarios
    const hasGiven = /Given:/.test(content);
    const hasWhen = /When:/.test(content);
    const hasThen = /Then:/.test(content);
    
    if (!hasGiven || !hasWhen || !hasThen) {
      warnings.push(`Spec ${specName} scenarios should use Given/When/Then structure`);
    }

    return { errors, warnings };
  }

  /**
   * Validate tasks.md structure
   */
  private validateTasks(content: string): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for phases
    if (!/Phase \d/.test(content) && !/## Phase/.test(content)) {
      warnings.push('Tasks should be organized by Phase');
    }

    // Check for task IDs
    const taskIds = content.match(/^-\s*\[.*\]\s*[A-Z]+-\d+/gm);
    if (!taskIds || taskIds.length === 0) {
      warnings.push('Tasks should have IDs (e.g., AGS-C01)');
    }

    return { errors, warnings };
  }
}

export const openSpecValidator = new OpenSpecValidator();