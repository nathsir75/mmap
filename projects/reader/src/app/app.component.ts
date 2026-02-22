import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';


  declare global {
  interface Window {
    mmReader?: { ping: () => Promise<any> };
  }
}


@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  title = 'reader';

ngOnInit() {
  console.log('[Reader][Angular] app init ✅');

  if (window.mmReader) {
    window.mmReader.ping().then(res => {
      console.log('[Reader][Angular] mmReader.ping =>', res);
    });
  } else {
    console.log('[Reader][Angular] mmReader not found (browser mode)');
  }
}
}
