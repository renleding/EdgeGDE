// Sprint 3 Integration Demo: ORCA → agent-runtime → result
// Run with: bun demo.ts

import { 
  TaskQueueImpl, 
  PluginRegistry, 
  TaskLifecycle, 
  ExecutionRunner,
  ConsoleLogger,
  createDefaultLogger,
  FileStateStore,
  TaskPersistence,
  Task,
  Plugin,
  PluginResult,
  StateStore,
  Logger,
  ExecutionContext,
} from './src/index';

import { 
  WorktreeManagerImpl, 
  createWorktreeManager,
  FanoutProtocol,
  ParallelCoordinator,
  Mission,
  MissionTask,
  FanoutConfig,
} from '../orca-ade/src/index';

// Simple test plugin for agent-runtime
const testPlugin: Plugin = {
  name: 'test-plugin',
  version: '1.0.0',
  handles: ['test-task'],
  execute: async (task: Task, context: ExecutionContext): Promise<PluginResult> => {
    console.log(`[Plugin] Executing task ${task.id} of type ${task.type}`);
    return {
      success: true,
      output: { message: 'Task completed successfully', taskId: task.id },
    };
  },
};

async function runDemo() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Sprint 3 Demo: ORCA → agent-runtime → result');
  console.log('═══════════════════════════════════════════════\n');

  // 1. Setup agent-runtime
  console.log('1. Setting up agent-runtime...');
  const queue = new TaskQueueImpl();
  const registry = new PluginRegistry();
  registry.register(testPlugin);
  
  const stateStore = new FileStateStore('.demo-state');
  const persistence = new TaskPersistence('.demo-state');
  const lifecycle = new TaskLifecycle(queue, persistence, 2);
  
  const logger = createDefaultLogger('demo');
  const runner = new ExecutionRunner(lifecycle, registry, logger);
  
  console.log('   ✅ agent-runtime initialized');

  // 2. Setup ORCA worktree manager
  console.log('\n2. Setting up ORCA worktree manager...');
  const worktreeManager = createWorktreeManager({
    basePath: '.demo-worktrees',
    maxWorktrees: 4,
    agentPrefix: 'demo-agent',
    gitRemote: 'origin',
  });
  console.log('   ✅ ORCA worktree manager initialized');

  // 3. Create a mission and fan it out
  console.log('\n3. Creating and fanning out mission...');
  const mission: Mission = {
    id: 'demo-mission-1',
    name: 'Demo Mission',
    description: 'Demonstrates ORCA fan-out to agent-runtime',
    tasks: [
      {
        id: 'task-1',
        name: 'First Task',
        type: 'test-task',
        payload: { step: 1 },
        dependsOn: [],
        scope: { paths: ['.'], allowNetwork: false, allowShell: false },
      },
      {
        id: 'task-2',
        name: 'Second Task',
        type: 'test-task',
        payload: { step: 2 },
        dependsOn: ['task-1'],
        scope: { paths: ['.'], allowNetwork: false, allowShell: false },
      },
      {
        id: 'task-3',
        name: 'Third Task',
        type: 'test-task',
        payload: { step: 3 },
        dependsOn: [],
        scope: { paths: ['.'], allowNetwork: false, allowShell: false },
      },
    ],
    scope: {
      allowedPaths: ['.'],
      forbiddenPaths: ['.git/**', 'node_modules/**'],
      allowNetwork: false,
      allowShell: false,
    },
    strategy: 'parallel',
    createdAt: Date.now(),
    status: 'pending',
  };

  const childMissions = FanoutProtocol.fanout(mission, 'parallel');
  console.log(`   ✅ Mission fanned out into ${childMissions.length} child missions`);

  // 4. Execute tasks via agent-runtime
  console.log('\n4. Executing tasks via agent-runtime...');
  
  // Create and execute tasks directly
  for (const childMission of childMissions) {
    for (const task of childMission.tasks) {
      const createdTask = await lifecycle.createTask({
        type: task.type,
        payload: task.payload,
        maxRetries: 3,
        plugin: task.type,
      });
      console.log(`   📋 Created task: ${createdTask.id} (${createdTask.type})`);
    }
  }

  // Run the execution runner for a few iterations
  console.log('\n5. Running execution runner...');
  let completed = 0;
  const maxIterations = 10;
  
  for (let i = 0; i < maxIterations; i++) {
    const task = await lifecycle.getNextTask();
    if (!task) {
      await new Promise(r => setTimeout(r, 100));
      continue;
    }

    const plugin = registry.get(task.type);
    if (plugin) {
      const context: ExecutionContext = {
        taskId: task.id,
        workingDir: process.cwd(),
        env: { ...process.env } as Record<string, string>,
        state: stateStore,
        logger,
      };
      
      const result = await plugin.execute(task, context);
      if (result.success) {
        await lifecycle.completeTask(task.id, result.output);
        completed++;
        console.log(`   ✅ Task ${task.id} completed: ${JSON.stringify(result.output)}`);
      } else {
        await lifecycle.failTask(task.id, result.error || 'Unknown error');
        console.log(`   ❌ Task ${task.id} failed`);
      }
    } else {
      await lifecycle.failTask(task.id, `No plugin for ${task.type}`);
      console.log(`   ❌ Task ${task.id} failed: no plugin`);
    }
  }

  // 6. Show results
  console.log('\n6. Final Results:');
  console.log(`   Tasks completed: ${completed}`);
  console.log(`   Tasks running: ${lifecycle.getRunningCount()}`);
  console.log(`   All tasks: ${lifecycle.getAllTasks().length}`);
  
  console.log('\n═══════════════════════════════════════════════');
  console.log('  Demo Complete: ORCA → agent-runtime → result ✅');
  console.log('═══════════════════════════════════════════════');
}

// Run the demo
runDemo().catch(console.error);