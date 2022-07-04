import replace from 'replace-in-file';

try {
   replace.sync({
       files: 'dist/**/dash.*',
       from: /dashjs/g,
       to: 'orb_dashjs'
   });
} catch (e) {
   console.error('Failed to replace dashjs with orb_dashjs: ', e);
   process.exit(1);
}