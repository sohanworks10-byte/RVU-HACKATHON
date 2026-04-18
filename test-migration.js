// Quick test to check if migration has been run
// Run with: node test-migration.js

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://psnrofnlgpqkfprjrbnm.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzbnJvZm5sZ3Bxa2ZwcmpyYm5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwNDYyMzksImV4cCI6MjA4MzYyMjIzOX0.oYlLKiEI7cO03H4IGyMV0r2HqJYo30tadfnl-XZZZMI';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testMigration() {
    console.log('Testing if migration has been run...\n');

    // Test 1: Check if agents table exists
    console.log('Test 1: Checking if agents table exists...');
    try {
        const { data, error } = await supabase.from('agents').select('count');
        if (error) {
            console.log('❌ FAILED: agents table does not exist');
            console.log('   Error:', error.message);
            console.log('\n⚠️  YOU NEED TO RUN THE MIGRATION!\n');
            console.log('   Go to: https://supabase.com/dashboard/project/psnrofnlgpqkfprjrbnm/sql/new');
            console.log('   Copy contents of: apps/backend/src/migrations/007_servers_and_agents.sql');
            console.log('   Paste and click RUN\n');
            return false;
        }
        console.log('✅ PASSED: agents table exists\n');
    } catch (e) {
        console.log('❌ FAILED:', e.message);
        return false;
    }

    // Test 2: Check if servers table exists
    console.log('Test 2: Checking if servers table exists...');
    try {
        const { data, error } = await supabase.from('servers').select('count');
        if (error) {
            console.log('❌ FAILED: servers table does not exist');
            console.log('   Error:', error.message);
            return false;
        }
        console.log('✅ PASSED: servers table exists\n');
    } catch (e) {
        console.log('❌ FAILED:', e.message);
        return false;
    }

    // Test 3: Check for any agents
    console.log('Test 3: Checking for connected agents...');
    try {
        const { data, error } = await supabase.from('agents').select('*');
        if (error) {
            console.log('❌ FAILED:', error.message);
            return false;
        }
        if (data && data.length > 0) {
            console.log(`✅ FOUND ${data.length} agent(s) in database:`);
            data.forEach(agent => {
                console.log(`   - Agent ID: ${agent.agent_id}`);
                console.log(`     Hostname: ${agent.hostname || 'N/A'}`);
                console.log(`     Status: ${agent.status}`);
                console.log(`     Last Seen: ${agent.last_seen || 'Never'}`);
                console.log('');
            });
        } else {
            console.log('⚠️  No agents found in database yet');
            console.log('   This is normal if agent hasn\'t connected after backend restart\n');
        }
    } catch (e) {
        console.log('❌ FAILED:', e.message);
        return false;
    }

    console.log('\n✅ ALL TESTS PASSED!');
    console.log('\nNext steps:');
    console.log('1. Restart your backend server');
    console.log('2. Verify agent is running on your server');
    console.log('3. Wait 30 seconds for agent to connect');
    console.log('4. Run this test again to see if agent appears');
    console.log('5. Restart desktop app COMPLETELY');
    
    return true;
}

testMigration().catch(console.error);
