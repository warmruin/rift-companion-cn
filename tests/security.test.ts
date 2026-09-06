import {it,expect} from 'vitest';
import {validateStatsArgs,allowedSource,elevationRelaunchSpec,normalizeHotkey} from '../electron/security';
it('only accepts known roles and integer champion IDs',()=>{expect(()=>validateStatsArgs('foo',1)).toThrow();expect(()=>validateStatsArgs('top','../x')).toThrow();expect(validateStatsArgs('mid',103)).toEqual({role:'mid',opponentId:103});});
it('only opens official source hosts over HTTPS',()=>{expect(allowedSource('https://op.gg/lol/champions')).toBe(true);expect(allowedSource('https://op.gg.evil.com/')).toBe(false);expect(allowedSource('file:///C:/Windows/')).toBe(false);expect(allowedSource('https://user:pass@op.gg/')).toBe(false);});
it('passes the executable through an environment variable instead of PowerShell interpolation',()=>{
 const executable='C:\\Program Files\\Rift Companion `unsafe` $test.exe';
 const spec=elevationRelaunchSpec(executable);
 expect(spec.file).toBe('powershell.exe');
 expect(spec.args.join(' ')).not.toContain(executable);
 expect(spec.environment.RIFT_COMPANION_EXE).toBe(executable);
 expect(spec.args.join(' ')).toContain('$env:RIFT_COMPANION_EXE');
});
it('normalizes safe rating hotkeys and rejects ordinary typing keys',()=>{
 expect(normalizeHotkey('f6')).toBe('F6');
 expect(normalizeHotkey('Ctrl+Shift+F7')).toBe('Control+Shift+F7');
 expect(()=>normalizeHotkey('A')).toThrow('快捷键');
 expect(()=>normalizeHotkey('Ctrl+A')).toThrow('快捷键');
});
