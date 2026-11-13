package br.com.bybusturismo.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ImpressaoPlugin.class); // antes do super.onCreate: o plugin precisa existir quando a página abre
        super.onCreate(savedInstanceState);
        // Android 13+: o aviso fixo "By Bus — rastreio ligado" (GPS em segundo plano) só aparece com esta permissão.
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.POST_NOTIFICATIONS }, 7001);
        }
    }
}
