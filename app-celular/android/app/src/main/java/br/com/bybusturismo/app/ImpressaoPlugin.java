package br.com.bybusturismo.app;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Impressão pelo Android (pedido do dono, 13/11/2026: lista física de passageiros no ônibus para a fiscalização).
 * Dentro do app o window.print() do navegador não faz nada; este plugin abre a tela "Imprimir" do Android com a página
 * atual (usa o mesmo layout de impressão do sistema). Serve qualquer impressora que apareça no Android (Wi-Fi, Wi-Fi Direct
 * ou Bluetooth com o serviço de impressão do fabricante) e também "Salvar como PDF".
 */
@CapacitorPlugin(name = "Impressao")
public class ImpressaoPlugin extends Plugin {
    @PluginMethod
    public void imprimir(PluginCall call) {
        String titulo = call.getString("titulo", "By Bus");
        getActivity().runOnUiThread(() -> {
            try {
                PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                PrintDocumentAdapter adaptador = getBridge().getWebView().createPrintDocumentAdapter(titulo);
                pm.print(titulo, adaptador, new PrintAttributes.Builder().build());
                call.resolve();
            } catch (Exception e) {
                call.reject("Não foi possível abrir a impressão: " + e.getMessage());
            }
        });
    }
}
