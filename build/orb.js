import replace from 'replace-in-file';
import fs from 'fs';

// add orb namespace
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

// add licence
try {
   const filepaths = [
      'dist/legacy/umd/dash.all.min.js',
      'dist/modern/umd/dash.all.min.js',
      'dist/modern/esm/dash.all.min.js'
   ];
   const licence = fs.readFileSync('build/orb_licence');
   for (const filepath of filepaths) {
      const data = fs.readFileSync(filepath);
      fs.writeFileSync(filepath, licence + data);
   }
} catch (e) {
   console.error('Failed to add ORB licence: ', e);
   process.exit(1);
}